#!/usr/bin/env bash
# One-time provisioning for the STAGING same-host isolated stack.
#
# Creates, idempotently and without ever touching production resources:
#   - /etc/piggybot-staging/{platform.env,ai-runtime.env}   (from examples, only if absent)
#   - PostgreSQL database $STAGING_DB_NAME                  (same instance, own database)
#   - systemd units piggybot-{platform,ai-runtime}-staging  (enabled, not started)
#   - nginx site staging.piggybot.me                        (installed + tested, not reloaded)
#   - /var/backups/piggybot-staging
#
# Usage:
#   scripts/provision-staging.sh           # provision (idempotent)
#   scripts/provision-staging.sh --check   # verify everything is in place
set -Eeuo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
staging_dir="${REPO_DIR:-$repo_dir}/deploy/staging"
env_dir="${STAGING_ENV_DIR:-/etc/piggybot-staging}"
backup_dir="${BACKUP_DIR:-/var/backups/piggybot-staging}"
staging_db_name="${STAGING_DB_NAME:-piggybot_staging}"
nginx_site="${STAGING_NGINX_SITE:-piggybot-staging}"
platform_unit="piggybot-platform-staging"
runtime_unit="piggybot-ai-runtime-staging"

fail() { echo "$1" >&2; exit 1; }

# Never let an override point this script at production resources.
case "$env_dir" in /etc/piggybot|/etc/piggybot/) fail "Refusing: $env_dir is the production env directory.";; esac
case "$backup_dir" in /var/backups/piggybot|/var/backups/piggybot/) fail "Refusing: $backup_dir is the production backup directory.";; esac
[[ "$staging_db_name" == 'piggybot' ]] && fail "Refusing: '$staging_db_name' is the production database name."

find_postgres_container() {
  local id image names
  while read -r id image names; do
    case "${image,,} ${names,,}" in
      *postgres*) printf '%s' "$id"; return 0;;
    esac
  done < <(sudo -n docker ps --format '{{.ID}} {{.Image}} {{.Names}}' 2>/dev/null)
  return 1
}

# Run a psql command against the instance's maintenance database, either with
# a host client (uses $PGADMIN_URL if set, else local peer auth) or inside the
# Postgres container as the image superuser.
admin_psql() {
  local sql="$1"
  if [[ -n "${PGADMIN_URL:-}" ]] && command -v psql >/dev/null 2>&1; then
    psql "$PGADMIN_URL" -v ON_ERROR_STOP=1 -c "$sql"
    return
  fi
  local container
  container="$(find_postgres_container || true)"
  [[ -z "$container" ]] && fail "No PostgreSQL container found and PGADMIN_URL is unset; create database '$staging_db_name' manually or set PGADMIN_URL."
  sudo -n docker exec "$container" psql -U "${PGADMIN_USER:-postgres}" -d postgres -v ON_ERROR_STOP=1 -c "$sql"
}

if [[ "${1:-}" == '--check' ]]; then
  missing=0
  for file in "$env_dir/platform.env" "$env_dir/ai-runtime.env"; do
    if ! sudo -n test -f "$file"; then echo "MISSING: $file"; missing=1; fi
  done
  for unit in "$platform_unit" "$runtime_unit"; do
    if ! sudo -n test -f "/etc/systemd/system/${unit}.service"; then echo "MISSING: /etc/systemd/system/${unit}.service"; missing=1; fi
  done
  if ! sudo -n test -f "/etc/nginx/sites-available/${nginx_site}"; then echo "MISSING: /etc/nginx/sites-available/${nginx_site}"; missing=1; fi
  if ! sudo -n test -L "/etc/nginx/sites-enabled/${nginx_site}"; then echo "MISSING: /etc/nginx/sites-enabled/${nginx_site} symlink"; missing=1; fi
  if ! sudo -n test -d "$backup_dir"; then echo "MISSING: $backup_dir"; missing=1; fi
  if ! admin_psql "SELECT 1 FROM pg_database WHERE datname = '$staging_db_name'" | grep -q 1; then
    echo "MISSING: database $staging_db_name"; missing=1
  fi
  if [[ "$missing" == 0 ]]; then echo "Staging provisioning is complete."; else exit 1; fi
  exit 0
fi

for required in platform.env.example ai-runtime.env.example nginx-staging.conf \
  "systemd/${platform_unit}.service" "systemd/${runtime_unit}.service"; do
  [[ -f "$staging_dir/$required" ]] || fail "Missing repo file: deploy/staging/$required (run from a full checkout)."
done

echo "==> Creating $env_dir (root-only)"
sudo install -d -m 0750 -o root -g root "$env_dir"
for name in platform ai-runtime; do
  target="$env_dir/${name}.env"
  if sudo -n test -e "$target"; then
    echo "    keeping existing $target (never overwritten)"
  else
    sudo install -m 0640 -o root -g root "$staging_dir/${name}.env.example" "$target"
    echo "    installed $target from example — FILL IN the staging secrets before starting services"
  fi
done

echo "==> Creating backup directory $backup_dir"
sudo install -d -m 0750 -o "$(id -un)" "$backup_dir"

echo "==> Ensuring database $staging_db_name exists"
if admin_psql "SELECT 1 FROM pg_database WHERE datname = '$staging_db_name'" | grep -q 1; then
  echo "    database already exists"
else
  admin_psql "CREATE DATABASE $staging_db_name"
  echo "    created $staging_db_name"
fi

echo "==> Installing systemd units (enabled, not started)"
# Match the service user of the production platform unit when one exists, so
# file ownership under the deploy directory works the same way for staging.
service_user="$(systemctl cat piggybot-platform 2>/dev/null | grep -m1 '^User=' | cut -d= -f2- || true)"
service_user="${service_user:-piggybot}"
for unit in "$platform_unit" "$runtime_unit"; do
  sudo install -m 0644 -o root -g root "$staging_dir/systemd/${unit}.service" "/etc/systemd/system/${unit}.service"
  if [[ "$service_user" != 'piggybot' ]]; then
    sudo sed -i "s/^User=piggybot$/User=${service_user}/;s/^Group=piggybot$/Group=${service_user}/" "/etc/systemd/system/${unit}.service"
  fi
done
echo "    service user: $service_user"
sudo systemctl daemon-reload
sudo systemctl enable "$platform_unit" "$runtime_unit"

echo "==> Installing nginx site $nginx_site"
sudo install -d -m 0755 -o root -g root /etc/nginx/sites-available /etc/nginx/sites-enabled
sudo install -m 0644 -o root -g root "$staging_dir/nginx-staging.conf" "/etc/nginx/sites-available/${nginx_site}"
if [[ ! -L "/etc/nginx/sites-enabled/${nginx_site}" ]]; then
  sudo ln -s "/etc/nginx/sites-available/${nginx_site}" "/etc/nginx/sites-enabled/${nginx_site}"
fi
sudo nginx -t

cat <<EOF

Staging provisioning complete. Remaining manual steps:
  1. Fill in the staging secrets in $env_dir/platform.env and
     $env_dir/ai-runtime.env (generate fresh values; see the comments in each
     file). chmod stays 0640 root:root — deploy via the existing sudo grant.
  2. Point staging.piggybot.me at this host in Cloudflare (DNS only or proxied
     with an Access/IP allowlist — staging must not be a public surface).
  3. sudo certbot --nginx -d staging.piggybot.me
  4. sudo systemctl reload nginx
  5. Update the staging checkout and deploy:
       cd /opt/ai-marketing-agent-staging && git fetch && git reset --hard origin/main
       bash scripts/deploy-staging.sh
  6. Run the real-model acceptance:
       cd /opt/ai-marketing-agent-staging/platform && node scripts/staging-acceptance.mjs
EOF
