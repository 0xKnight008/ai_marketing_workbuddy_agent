#!/usr/bin/env bash
# Deploy the STAGING same-host isolated stack (staging.piggybot.me).
#
# Mirrors scripts/deploy-production.sh, but every touchpoint is staging-only:
# separate deploy directory, env files, database, systemd units and ports.
# Hard guards below refuse to run if any path or port points at production —
# a misconfigured staging deploy must never stop, migrate, or overwrite the
# production stack.
set -Eeuo pipefail

deploy_dir="${DEPLOY_DIR:-/opt/ai-marketing-agent-staging}"
platform_env="${PLATFORM_ENV_FILE:-/etc/piggybot-staging/platform.env}"
runtime_env="${AI_RUNTIME_ENV_FILE:-/etc/piggybot-staging/ai-runtime.env}"
backup_dir="${BACKUP_DIR:-/var/backups/piggybot-staging}"
staging_db_name="${STAGING_DB_NAME:-piggybot_staging}"
platform_unit="${STAGING_PLATFORM_UNIT:-piggybot-platform-staging}"
runtime_unit="${STAGING_RUNTIME_UNIT:-piggybot-ai-runtime-staging}"
platform_stopped=false

restart_platform_on_error() {
  local exit_code=$?
  trap - ERR
  if [[ "$platform_stopped" == true ]]; then
    echo "Staging deployment failed after stopping ${platform_unit}; restarting the existing service." >&2
    sudo systemctl restart "$platform_unit" || true
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

# The database runs as a Docker container while the deploy host may have no
# PostgreSQL client installed. Locate the running container so its own
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

# Read one KEY=value from an env file without sourcing it (direct read, or via
# the existing non-interactive sudo grant for root-only files).
read_env_value() {
  local file="$1" key="$2" contents
  if [[ -r "$file" ]]; then
    contents="$(cat -- "$file")"
  else
    contents="$(sudo -n cat -- "$file")"
  fi
  grep -E "^${key}=" <<< "$contents" | tail -n 1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

# --- Production-collision guards (run before any file is touched) -----------

for path in "$deploy_dir" "$platform_env" "$runtime_env" "$backup_dir"; do
  case "$path" in
    /opt/ai-marketing-agent|/opt/ai-marketing-agent/|/etc/piggybot|/etc/piggybot/*|/var/backups/piggybot|/var/backups/piggybot/)
      echo "Refusing to run: '$path' is a production path. Staging paths must stay under /opt/ai-marketing-agent-staging, /etc/piggybot-staging and /var/backups/piggybot-staging." >&2
      exit 1
      ;;
  esac
done
for unit in "$platform_unit" "$runtime_unit"; do
  case "$unit" in
    piggybot-platform|piggybot-ai-runtime|piggybot-platform.service|piggybot-ai-runtime.service)
      echo "Refusing to run: '$unit' is a production systemd unit. Staging units must end in -staging." >&2
      exit 1
      ;;
  esac
done

for required_file in "$platform_env" "$runtime_env"; do
  # systemd reads these as root. The SSH account need not have direct access
  # to secret files, but deployment requires an existing sudo grant.
  if [[ ! -r "$required_file" ]] && ! sudo -n test -r "$required_file"; then
    echo "Required environment file is missing or inaccessible: $required_file (checked deployment user and non-interactive sudo). Run scripts/provision-staging.sh first; do not make secrets world-readable." >&2
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
  echo "Staging environment files are accessible."
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
: "${DATABASE_URL:?DATABASE_URL must be set in the staging platform environment file}"

# The staging database name must match the configured staging name. This is
# the guard that keeps a copy-pasted production DATABASE_URL out of staging
# migrations and backups.
db_name="$(database_url_name)"
if [[ "$db_name" != "$staging_db_name" ]]; then
  echo "Refusing to run: DATABASE_URL targets database '$db_name', expected '$staging_db_name'. Point the staging environment at its own database." >&2
  exit 1
fi

# Port guards: staging services must never bind the production ports. The
# platform defaults to 4100 when GATEWAY_PORT is unset, so require an explicit
# non-production value; same for the ai-runtime PORT (default 4111).
gateway_port="${GATEWAY_PORT:-}"
if [[ -z "$gateway_port" || "$gateway_port" == '4100' ]]; then
  echo "Refusing to run: GATEWAY_PORT must be set to the staging port (e.g. 4200), never the production port 4100." >&2
  exit 1
fi
runtime_port="$(read_env_value "$runtime_env" PORT)"
if [[ -z "$runtime_port" || "$runtime_port" == '4111' ]]; then
  echo "Refusing to run: PORT in $runtime_env must be set to the staging port (e.g. 4211), never the production port 4111." >&2
  exit 1
fi
case "${AI_RUNTIME_URL:-}" in
  *:4111*|'')
    echo "Refusing to run: AI_RUNTIME_URL must point at the staging ai-runtime (e.g. http://127.0.0.1:4211), never the production port 4111." >&2
    exit 1
    ;;
esac

# ai-runtime dependencies must be installed BEFORE the platform typecheck:
# the platform tsconfig type-checks ../ai-runtime/src schemas, and resolving
# their imports (zod, etc.) requires ai-runtime/node_modules to exist. On a
# fresh checkout it does not exist yet, so platform-first ordering fails.
cd "$deploy_dir/ai-runtime"
npm ci

cd "$deploy_dir/platform"
npm ci
npm run typecheck
npm test

cd "$deploy_dir/ai-runtime"
npm run typecheck
npm test
npm run build

# Staging frontend: static Vite build served by the host nginx. VITE_GATEWAY_URL
# stays unset so the build calls the same-origin /api on staging.piggybot.me.
cd "$deploy_dir"
npm ci
npm run build
test -f dist/index.html
# nginx (www-data) must be able to read the static tree.
chmod 0755 "$deploy_dir" "$deploy_dir/dist"
find dist -type d -exec chmod 0755 {} +
find dist -type f -exec chmod 0644 {} +

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

sudo systemctl stop "$platform_unit"
platform_stopped=true

cd "$deploy_dir/platform"
npm run migrate
npm run db:check

sudo systemctl restart "$runtime_unit" "$platform_unit"
platform_stopped=false

for attempt in {1..30}; do
  if curl --fail --silent --show-error "http://127.0.0.1:${runtime_port}/internal/health" >/dev/null \
    && curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:${gateway_port}/internal/ready" >/dev/null \
    && test -f "$deploy_dir/dist/index.html"; then
    echo "Staging deployment passed all health checks."
    exit 0
  fi
  sleep 2
done

echo "Staging deployment failed health checks; inspect service logs (journalctl -u $platform_unit -u $runtime_unit)." >&2
exit 1
