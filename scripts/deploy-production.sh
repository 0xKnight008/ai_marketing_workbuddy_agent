#!/usr/bin/env bash
set -Eeuo pipefail

deploy_dir="${DEPLOY_DIR:-/opt/ai-marketing-agent}"
platform_env="${PLATFORM_ENV_FILE:-/etc/piggybot/platform.env}"
runtime_env="${AI_RUNTIME_ENV_FILE:-/etc/piggybot/ai-runtime.env}"
public_api_env="${PUBLIC_API_ENV_FILE:-/etc/piggybot/public-api.env}"
backup_dir="${BACKUP_DIR:-/var/backups/piggybot}"

for required_file in "$platform_env" "$runtime_env" "$public_api_env"; do
  if [[ ! -r "$required_file" ]]; then
    echo "Required environment file is not readable: $required_file" >&2
    exit 1
  fi
done

set -a
# shellcheck disable=SC1090
source "$platform_env"
set +a
: "${DATABASE_URL:?DATABASE_URL must be set in the platform environment file}"

sudo install -d -m 0750 -o "$(id -un)" "$backup_dir"
backup_file="$backup_dir/predeploy-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --file="$backup_file" "$DATABASE_URL"
test -s "$backup_file"

sudo systemctl stop piggybot-platform || true

cd "$deploy_dir/platform"
npm ci
npm run typecheck
npm test
npm run migrate

cd "$deploy_dir/ai-runtime"
npm ci
npm run typecheck
npm test
npm run build

cd "$deploy_dir"
export PUBLIC_API_ENV_FILE="$public_api_env"
sudo docker build -f Dockerfile.fixed -t ai-marketing-agent:latest .
sudo docker compose build newsletter-api
sudo docker compose up -d

sudo systemctl restart piggybot-ai-runtime piggybot-platform

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
