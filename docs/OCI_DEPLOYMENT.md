# Oracle Cloud Infrastructure deployment runbook

This runbook deploys the public site, gateway, worker, AI runtime, PostgreSQL, Stripe webhook, and TLS on one OCI Compute instance.

```text
Internet → OCI public IP → Nginx :443
                          ├─ website container       127.0.0.1:8001
                          ├─ platform gateway        127.0.0.1:4100
                          └─ Stripe webhook          127.0.0.1:4100/webhooks/stripe

PostgreSQL (private)      127.0.0.1:5432
Worker (private)          executes queued jobs
AI runtime (private)      127.0.0.1:4111
```

Only ports 80 and 443 are public. Do not expose 4100, 4111, 5432, or 8001.

## 1. OCI foundation

1. Create a compartment, VCN, public subnet, Internet Gateway, route rule, and Compute instance with a supported Ubuntu or Oracle Linux image.
2. Reserve and attach a public IPv4 address; point the production DNS `A` record to it.
3. In the OCI network security group or subnet security list, allow only:

   | Source | Port | Purpose |
   | --- | ---: | --- |
   | Administrator VPN/office CIDR | 22/TCP | SSH |
   | Internet | 80/TCP | HTTP redirect and ACME validation |
   | Internet | 443/TCP | Website, API, Stripe webhook |

4. Apply the same restriction in the instance firewall. OCI network rules and the OS firewall are independent controls.

See Oracle's [Compute instance](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/launchinginstance.htm), [SSH access](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/accessinginstance.htm), and [network firewall](https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/managingfirewalls.htm) guides.

## 2. Bootstrap the host

The package commands below are for Ubuntu. Use the Oracle Linux equivalents when appropriate.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git nginx certbot python3-certbot-nginx ufw
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo adduser --disabled-password --gecos '' piggybot
sudo usermod -aG docker piggybot
sudo install -d -o piggybot -g piggybot /srv/piggybot /etc/piggybot /var/backups/piggybot
```

Install Node.js 22 and `pnpm`; verify the Node version meets the `engines` field in the platform and AI-runtime packages.

Before enabling UFW, allow the CIDR that contains your current SSH address:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <ADMIN_CIDR> to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 3. Application, PostgreSQL, and secrets

Deploy a reviewed release tag, never a local worktree:

```bash
sudo -u piggybot git clone git@github.com:0xKnight008/ai_marketing_workbuddy_agent.git /srv/piggybot/current
```

Use managed PostgreSQL in the OCI VCN for customer data where possible. For a first deployment, a local PostgreSQL service is acceptable only when it listens on `127.0.0.1:5432`, has a dedicated database role, and is backed up off-host.

Create the protected environment files, owned by `root:piggybot` with mode `0640`:

```bash
sudo install -m 0640 -o root -g piggybot /dev/null /etc/piggybot/platform.env
sudo install -m 0640 -o root -g piggybot /dev/null /etc/piggybot/ai-runtime.env
```

Fill them from `platform/.env.example` and `ai-runtime/.env.example`. Production values must include:

- `DATABASE_URL`, `AUTH_TOKEN_SECRET`, `INTERNAL_SERVICE_TOKEN`, `SECRET_ENCRYPTION_KEY_BASE64`
- `AI_RUNTIME_EVENT_SIGNING_SECRET`, `OPENAI_API_KEY`, and all three `AI_MODEL_*` values
- `CORS_ORIGINS=https://app.example.com`, `PUBLIC_SITE_URL=https://app.example.com`
- `RUN_SERVICE_CALLBACK_URL=http://127.0.0.1:4100/internal/ai-runtime-events`
- shared production `MASTRA_STORAGE_URL`—do not use `file:` storage in production.

Migrate before the worker starts, after taking a database backup:

```bash
cd /srv/piggybot/current/platform
set -a; . /etc/piggybot/platform.env; set +a
pnpm install --frozen-lockfile
pnpm migrate
```

## 4. Platform services

Use `systemd` for the gateway, worker, and AI runtime. Each unit should set `User=piggybot`, `Restart=always`, `RestartSec=5`, `NoNewPrivileges=true`, its `EnvironmentFile`, and the following working directory/command:

| Unit | Working directory | `ExecStart` |
| --- | --- | --- |
| `piggybot-gateway.service` | `/srv/piggybot/current/platform` | `pnpm dev:gateway` |
| `piggybot-worker.service` | `/srv/piggybot/current/platform` | `pnpm dev:worker` |
| `piggybot-ai-runtime.service` | `/srv/piggybot/current/ai-runtime` | `pnpm build && pnpm start` |

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now piggybot-gateway piggybot-worker piggybot-ai-runtime
sudo systemctl status piggybot-gateway piggybot-worker piggybot-ai-runtime
journalctl -u piggybot-gateway -f
```

Build the website with the existing Docker configuration. Bind its published port to loopback (`127.0.0.1:8001:80`), not all interfaces. Set `VITE_GATEWAY_URL=https://app.example.com` at build time if Nginx proxies the gateway on the same public hostname.

## 5. Nginx and HTTPS

For `app.example.com`, proxy `/` to the website, `/api/` and `/webhooks/stripe` to the gateway, and do not proxy `/internal/` publicly.

```nginx
location /api/ {
  proxy_pass http://127.0.0.1:4100;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
}
location = /webhooks/stripe {
  proxy_pass http://127.0.0.1:4100;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
}
location / {
  proxy_pass http://127.0.0.1:8001;
  proxy_set_header Host $host;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d app.example.com
sudo systemctl enable --now certbot.timer
```

Confirm that HTTP redirects to HTTPS and that `https://app.example.com/internal/ai-runtime-events` is not exposed.

## 6. Stripe activation

Create Stripe recurring Prices for Creator ($19), Growth ($59), and Agency ($169). Put these only in `/etc/piggybot/platform.env`:

```text
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_CREATOR=price_...
STRIPE_PRICE_GROWTH=price_...
STRIPE_PRICE_AGENCY=price_...
STRIPE_TRIAL_DAYS=7
```

Register `https://app.example.com/webhooks/stripe` and subscribe to `checkout.session.completed`. The gateway verifies Stripe's signed raw request, records the event idempotently, then activates the workspace. Never put `STRIPE_SECRET_KEY` or `BILLING_ADMIN_TOKEN` in browser code, Git, Docker images, or shell history. Follow Stripe's [Checkout subscription](https://docs.stripe.com/payments/checkout/build-subscriptions) and [webhook-signature](https://docs.stripe.com/webhooks/signature) setup guides.

Test in Stripe test mode: a test Checkout should produce webhook HTTP 200, one `billing_webhook_event` record, and a workspace transition from `inactive` to `trialing`.

## 7. Release, backups, and incidents

Release order:

1. Back up PostgreSQL to a separate OCI Object Storage bucket and verify the artifact.
2. Stop `piggybot-worker` so no job executes during a schema change.
3. Check out the approved tag, install locked dependencies, run migrations, and restart AI runtime, gateway, then worker.
4. Rebuild/restart the website container last; run smoke checks.

```bash
sudo systemctl stop piggybot-worker
cd /srv/piggybot/current && git fetch --tags && git checkout <release-tag>
cd platform && pnpm install --frozen-lockfile && pnpm migrate
cd ../ai-runtime && pnpm install --frozen-lockfile && pnpm build
cd .. && docker compose up -d --build
sudo systemctl restart piggybot-ai-runtime piggybot-gateway piggybot-worker
curl -fsS http://127.0.0.1:4100/internal/health
curl -fsS https://app.example.com/
sudo systemctl --failed
```

Daily: inspect service journals, Stripe delivery failures, PostgreSQL health, disk space, container-image growth, and backup completion. Test an encrypted PostgreSQL restore monthly on an isolated database. Store OCI, Stripe, OpenAI, database, GitHub, and application credentials in OCI Vault or protected environment files.

| Symptom | First checks |
| --- | --- |
| Site unavailable | OCI instance health, Nginx status, website container, certificate expiry |
| API errors | Gateway journal, PostgreSQL connection, environment file |
| Jobs stalled | Worker status, job table, AI runtime health, internal token |
| Stripe paid but no activation | Stripe delivery log, webhook URL/TLS, `STRIPE_WEBHOOK_SECRET`, gateway log, `billing_webhook_event` |
| AI failure | Runtime log, provider key/model, shared storage, callback signing secret |

Never include full tokens, webhook payloads, customer data, or environment files in tickets or chat.
