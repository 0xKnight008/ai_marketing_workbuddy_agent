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

url_decode() {
  local value="${1//+/ }"
  printf '%b' "${value//%/\\x}"
}

# DATABASE_URL = postgres://user[:password]@host[:port]/name[?params]
database_url_userinfo() {
  local without_scheme="${DATABASE_URL#*://}"
  local userinfo="${without_scheme%%@*}"
  if [[ "$userinfo" == "$without_scheme" ]]; then
    userinfo=''
  fi
  printf '%s' "$userinfo"
}

database_url_user() {
  local userinfo
  userinfo="$(database_url_userinfo)"
  url_decode "${userinfo%%:*}"
}

database_url_password() {
  local userinfo
  userinfo="$(database_url_userinfo)"
  if [[ "$userinfo" == *:* ]]; then
    url_decode "${userinfo#*:}"
  fi
}

database_url_host() {
  local without_scheme="${DATABASE_URL#*://}"
  local host="${without_scheme#*@}"
  host="${host%%/*}"
  host="${host%%\?*}"
  host="${host%:*}"
  printf '%s' "$host"
}

database_url_name() {
  local without_scheme="${DATABASE_URL#*://}"
  local name="${without_scheme#*/}"
  name="${name%%\?*}"
  printf '%s' "$name"
}

# The production database runs as a Docker container while the deploy host has
# no PostgreSQL client installed. Locate the running container so its own
# (version-matched) pg_dump can produce the pre-deploy backup.
find_postgres_container() {
  local id image names
  while read -r id image names; do
    case "${image,,} ${names,,}" in
      *postgres*)
        printf '%s' "$id"
        return 0
        ;;
    esac
  done < <(sudo -n docker ps --format '{{.ID}} {{.Image}} {{.Names}}' 2>/dev/null)
  return 1
}

for required_file in "$platform_env" "$runtime_env" "$public_api_env"; do
  # systemd/Docker read these as root. The SSH account need not have direct
  # access to secret files, but deployment requires an existing sudo grant.
  if [[ ! -r "$required_file" ]] && ! sudo -n test -r "$required_file"; then
    echo "Required environment file is missing or inaccessible: $required_file (checked deployment user and non-interactive sudo). Provision the file or correct its configured path; do not make secrets world-readable." >&2
    exit 1
  fi
done

if [[ "${1:-}" == '--check' ]]; then
  # Fail here — before any live file is replaced — when no pg_dump source
  # (host client or Postgres container) is available for the backup step.
  if ! command -v pg_dump >/dev/null 2>&1 && ! find_postgres_container >/dev/null; then
    echo "Neither pg_dump nor a running Postgres container is available for the pre-deploy backup; install postgresql-client on the deploy host." >&2
    exit 1
  fi
  echo "Production environment files are accessible."
  exit 0
fi

# CI reaches this script through a non-interactive SSH shell that never sources
# the user's profile, so Node.js installed via nvm is missing from PATH.
# Load nvm (or fall back to common install locations) before any npm call.
if ! command -v npm >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
  fi
fi
if ! command -v npm >/dev/null 2>&1; then
  for candidate in /usr/local/bin /usr/bin "$HOME"/.nvm/versions/node/*/bin; do
    if [[ -x "$candidate/npm" ]]; then
      PATH="$candidate:$PATH"
      break
    fi
  done
  export PATH
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not available in PATH for this non-interactive shell; install Node.js or expose it system-wide (e.g. symlink node/npm/npx into /usr/local/bin)." >&2
  exit 127
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
if command -v pg_dump >/dev/null 2>&1; then
  pg_dump --format=custom --file="$backup_file" "$DATABASE_URL"
else
  # No PostgreSQL client on the deploy host: run the version-matched client
  # inside the Postgres container. Restricted to loopback DATABASE_URLs so a
  # remote database is never confused with a local container.
  db_host="$(database_url_host)"
  if [[ "$db_host" != 'localhost' && "$db_host" != '127.0.0.1' && "$db_host" != '::1' ]]; then
    echo "pg_dump is missing on the deploy host and DATABASE_URL points at non-local host '$db_host'; install postgresql-client on the deploy host." >&2
    exit 1
  fi
  db_container="$(find_postgres_container || true)"
  if [[ -z "$db_container" ]]; then
    echo "pg_dump is missing on the deploy host and no running Postgres container was found; install postgresql-client on the deploy host." >&2
    exit 1
  fi
  echo "pg_dump not found on host; backing up through Postgres container $db_container."
  sudo -n docker exec \
    -e PGPASSWORD="$(database_url_password)" \
    "$db_container" \
    pg_dump --format=custom -h 127.0.0.1 -U "$(database_url_user)" -d "$(database_url_name)" \
    > "$backup_file"
fi
test -s "$backup_file"
# Custom-format dumps carry a PGDMP magic header; catch truncated or
# wrong-target backups before they are trusted.
[[ "$(head -c 5 "$backup_file")" == 'PGDMP' ]]

sudo systemctl stop piggybot-platform
platform_stopped=true

cd "$deploy_dir/platform"
npm run migrate
npm run db:check

cd "$deploy_dir"
sudo docker compose up -d

sudo systemctl restart piggybot-ai-runtime piggybot-platform
platform_stopped=false

for attempt in {1..30}; do
  if curl --fail --silent --show-error http://127.0.0.1:4111/internal/health >/dev/null \
    && curl --fail --silent --show-error --max-time 10 http://127.0.0.1:4100/internal/ready >/dev/null \
    && curl --fail --silent --show-error http://127.0.0.1:8001/ >/dev/null; then
    echo "Production deployment passed all health checks."
    exit 0
  fi
  sleep 2
done

echo "Production deployment failed health checks; inspect service and container logs." >&2
exit 1
