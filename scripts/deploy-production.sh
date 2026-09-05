#!/usr/bin/env bash
set -Eeuo pipefail

deploy_dir="${DEPLOY_DIR:-/opt/ai-marketing-agent}"
platform_env="${PLATFORM_ENV_FILE:-/etc/piggybot/platform.env}"
runtime_env="${AI_RUNTIME_ENV_FILE:-/etc/piggybot/ai-runtime.env}"
public_api_env="${PUBLIC_API_ENV_FILE:-/etc/piggybot/public-api.env}"
backup_dir="${BACKUP_DIR:-/var/backups/piggybot}"
platform_stopped=false

restart_platform_on_error() {
  local exit_code=$?
  trap - ERR
  if [[ "$platform_stopped" == true ]]; then
    echo "Deployment failed after stopping piggybot-platform; restarting the existing service." >&2
    sudo systemctl restart piggybot-platform || true
  fi
  exit "$exit_code"
}

trap restart_platform_on_error ERR

for required_file in "$platform_env" "$runtime_env" "$public_api_env"; do
  # systemd/Docker read these as root. The SSH account need not have direct
  # access to secret files, but deployment requires an existing sudo grant.
  if [[ ! -r "$required_file" ]] && ! sudo -n test -r "$required_file"; then
    echo "Required environment file is missing or inaccessible: $required_file (checked deployment user and non-interactive sudo). Provision the file or correct its configured path; do not make secrets world-readable." >&2
    exit 1
  fi
done

if [[ "${1:-}" == '--check' ]]; then
  echo "Production environment files are accessible."
  exit 0
fi

set -a
# shellcheck disable=SC1090
if [[ -r "$platform_env" ]]; then
  source "$platform_env"
else
  # Capture first so a failed privileged read cannot be hidden by `source`.
  platform_environment="$(sudo -n cat -- "$platform_env")"
  source /dev/stdin <<< "$platform_environment"
  unset platform_environment
fi
set +a
: "${DATABASE_URL:?DATABASE_URL must be set in the platform environment file}"

cd "$deploy_dir/platform"
npm ci
npm run typecheck
npm test

cd "$deploy_dir/ai-runtime"
npm ci
npm run typecheck
npm test
npm run build

cd "$deploy_dir"
export PUBLIC_API_ENV_FILE="$public_api_env"
sudo docker build -f Dockerfile.fixed -t ai-marketing-agent:latest .
sudo docker compose build newsletter-api

sudo install -d -m 0750 -o "$(id -un)" "$backup_dir"
backup_file="$backup_dir/predeploy-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --file="$backup_file" "$DATABASE_URL"
test -s "$backup_file"

sudo systemctl stop piggybot-platform
platform_stopped=true

cd "$deploy_dir/platform"
npm run migrate

cd "$deploy_dir"
sudo docker compose up -d

sudo systemctl restart piggybot-ai-runtime piggybot-platform
platform_stopped=false

for attempt in {1..30}; do
  if curl --fail --silent --show-error http://127.0.0.1:4111/internal/health >/dev/null \
    && curl --fail --silent --show-error http://127.0.0.1:4100/internal/health >/dev/null \
    && curl --fail --silent --show-error http://127.0.0.1:8001/ >/dev/null; then
    echo "Production deployment passed all health checks."
    exit 0
  fi
  sleep 2
done

echo "Production deployment failed health checks; inspect service and container logs." >&2
exit 1
