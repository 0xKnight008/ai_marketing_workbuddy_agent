# Staging 搭建手册：同机隔离栈 + 真实 routing proxy

在 piggybot-2 上从零搭好 staging 隔离栈（staging.piggybot.me）并接入真实
routing proxy 的分步操作。全程在服务器上执行，按顺序进行，每步附验证命令。
架构与安全边界见 [STAGING.md](./STAGING.md)；本文档是操作流程。

## 第 0 步：准备 staging 代码检出

```bash
# 服务器上：
sudo mkdir -p /opt/ai-marketing-agent-staging
sudo chown "$USER:$USER" /opt/ai-marketing-agent-staging
git clone https://github.com/0xKnight008/ai_marketing_workbuddy_agent /opt/ai-marketing-agent-staging
```

## 第 1 步：一次性 provisioning

```bash
cd /opt/ai-marketing-agent-staging
bash scripts/provision-staging.sh
```

幂等创建：`/etc/piggybot-staging/`（两个 env 文件，从示例安装，绝不覆盖
已有文件）、`piggybot_staging` 数据库、两个 `*-staging` systemd 单元
（enable 不 start）、nginx 站点、`/var/backups/piggybot-staging`。

复核：

```bash
bash scripts/provision-staging.sh --check   # 应输出 "Staging provisioning is complete."
```

若数据库创建失败（找不到 Postgres 容器），手工建库：

```bash
sudo docker exec <postgres容器名> psql -U postgres -c "CREATE DATABASE piggybot_staging;"
```

## 第 2 步：填写 staging 密钥（platform.env）

```bash
sudoedit /etc/piggybot-staging/platform.env
```

生成密钥（每条命令按需多跑几次，每个值各不相同）：

```bash
openssl rand -hex 32       # INTERNAL_SERVICE_TOKEN / AUTH_TOKEN_SECRET /
                           # ZERNIO_OAUTH_STATE_SECRET / BILLING_ADMIN_TOKEN
openssl rand -base64 32    # SECRET_ENCRYPTION_KEY_BASE64
openssl rand -hex 16       # EGG_COOKIE_KEYS 需要两个以上逗号分隔的长随机值
```

关键项：

```dotenv
DATABASE_URL=postgres://piggybot:<同库实例的密码>@127.0.0.1:5432/piggybot_staging
GATEWAY_PORT=4200
AI_RUNTIME_URL=http://127.0.0.1:4211
CORS_ORIGINS=https://staging.piggybot.me
PUBLIC_SITE_URL=https://staging.piggybot.me
TRUST_PROXY=true
EGG_SERVER_ENV=prod
EGG_COOKIE_KEYS=<随机值1>,<随机值2>
SECRET_ENCRYPTION_KEY_BASE64=<base64 32字节>
INTERNAL_SERVICE_TOKEN=<随机A>
AUTH_TOKEN_SECRET=<随机B>
AI_RUNTIME_EVENT_SIGNING_SECRET=<随机C>
STRIPE_SECRET_KEY=sk_test_...        # staging 只用 test 模式
# RESEND / Zernio / Discord 可留空，通知事件会留在 queued 供查看
```

**不要从 `/etc/piggybot/platform.env` 复制任何密钥**——staging 与生产
密钥完全独立，任一环境泄露不会打开另一个。

## 第 3 步：ai-runtime 接真实 routing proxy

```bash
sudoedit /etc/piggybot-staging/ai-runtime.env
```

```dotenv
AI_MODEL_ROUTING_MODE=proxy
OPENAI_BASE_URL=<与生产相同的 proxy 地址，必须以 /v1 结尾>
OPENAI_API_KEY=<单独签发的 proxy key>

AI_MODEL_ECO=openai/primary-eco
AI_MODEL_STANDARD=openai/primary-standard
AI_MODEL_FLAGSHIP=openai/primary-flagship
AI_MODEL_ECO_FALLBACK=openai/fallback-eco
AI_MODEL_STANDARD_FALLBACK=openai/fallback-standard
AI_MODEL_FLAGSHIP_FALLBACK=openai/fallback-flagship

INTERNAL_API_TOKEN=<随机A，必须与 platform.env 的 INTERNAL_SERVICE_TOKEN 完全一致>
EVENT_CALLBACK_SIGNING_SECRET=<随机C，必须与 AI_RUNTIME_EVENT_SIGNING_SECRET 一致>
RUN_SERVICE_CALLBACK_URL=http://127.0.0.1:4200/internal/ai-runtime-events
PORT=4211
HOST=127.0.0.1
MASTRA_STORAGE_URL=file:./mastra-staging.db
```

proxy 地址可直接查生产配置：

```bash
sudo grep OPENAI_BASE_URL /etc/piggybot/ai-runtime.env
```

key 建议在 one-api/new-api 后台**单独签发一把**（额度可独立限、泄露可
独立吊销）；六个别名沿用现有渠道映射即可，无需在 proxy 侧新增模型。
上游模型名是 proxy 的内部实现，ai-runtime 只认 `openai/primary-*` /
`openai/fallback-*` 别名（见 [LLM_ROUTING_PROXY.md](./LLM_ROUTING_PROXY.md)）。

### 启动前的 proxy 验证（必做）

```bash
# 1. 六个别名对这把 key 可见（应输出 6 行）
curl -s <OPENAI_BASE_URL>/models -H "Authorization: Bearer <staging key>" \
  | grep -o 'primary-eco\|primary-standard\|primary-flagship\|fallback-eco\|fallback-standard\|fallback-flagship' | sort -u

# 2. 每个别名发一条最小请求，确认能出内容
curl -s <OPENAI_BASE_URL>/chat/completions \
  -H "Authorization: Bearer <staging key>" -H 'content-type: application/json' \
  -d '{"model":"primary-eco","messages":[{"role":"user","content":"say ok"}],"max_tokens":5}'
```

## 第 4 步：DNS + TLS + 访问限制

1. Cloudflare DNS：`staging.piggybot.me` A 记录指向主机 IP，开橙色云。
2. **staging 不是公开面**：在 Cloudflare 加 Access 策略或 WAF IP 白名单
   （只允许自己的 IP）；或启用 `deploy/staging/nginx-staging.conf` 里
   注释掉的 basic auth 两行。
3. 签发证书并生效：

```bash
sudo certbot --nginx -d staging.piggybot.me
sudo systemctl reload nginx
```

## 第 5 步：部署 + 验证

```bash
cd /opt/ai-marketing-agent-staging
bash scripts/deploy-staging.sh
```

脚本依次执行：platform/ai-runtime 的 `npm ci` + typecheck + 测试、
ai-runtime build、前端静态 build、staging 库 pg_dump 备份（PGDMP 校验）、
停 staging platform → migrate → db:check → 重启两个 staging 单元 →
4200/4211 健康检查。失败后 ERR trap 只会重启 staging 单元。

成功后验证：

```bash
curl -fsS http://127.0.0.1:4200/internal/ready        # platform 就绪
curl -fsS http://127.0.0.1:4211/internal/health       # ai-runtime 健康
curl -s https://staging.piggybot.me/internal/health   # 公网必须 404
sudo ss -tlnp | grep -E '4200|4211'                   # 确认只绑定 127.0.0.1
```

## 第 6 步：真实模型六模板验收

```bash
cd /opt/ai-marketing-agent-staging/platform
node scripts/staging-acceptance.mjs
```

预期输出：500 条数据集分类完成 → 六个模板逐行 `generated in Xs` →
故障恢复测试（自动停/起 `piggybot-ai-runtime-staging`，验证报告挂起
不失败、恢复后完成且重试不重复扣费）→ 指标表 + `Staging acceptance: PASS`。

可选参数：

```bash
node scripts/staging-acceptance.mjs --skip-failure-recovery   # 无 systemctl 免密 sudo 时跳过故障注入
node scripts/staging-acceptance.mjs --min-grounded-rate 0.6   # 调整证据率下限
node scripts/staging-acceptance.mjs --max-latency-ms 900000   # 调整单模板延迟预算
```

## 常见问题

- **验收在分类阶段慢**：500 条真实分类受 proxy 速率限制，属正常现象；
  重跑会新建工作区，互不影响。
- **某模板 `template_acceptance_failed`**：与生产 worker 行为一致——
  模型输出未过模板验收时宁可失败也不注水。查看报告 error 字段判断是
  证据不足还是模板结构问题。
- **部署脚本报 `Refusing to run`**：env 里残留了生产端口/库名/URL，
  按报错对照 `deploy/staging/*.env.example` 逐项修正。
- **看日志**：`journalctl -u piggybot-platform-staging -u piggybot-ai-runtime-staging -f`
- **重置 staging 数据**：staging 数据视为一次性，积累过多时重建数据库：

  ```bash
  sudo docker exec <postgres容器名> psql -U postgres -c \
    "DROP DATABASE piggybot_staging; CREATE DATABASE piggybot_staging;"
  cd /opt/ai-marketing-agent-staging/platform
  set -a; eval "$(sudo cat /etc/piggybot-staging/platform.env)"; set +a
  npm run migrate && npm run db:check
  ```

## 日常部署

```bash
cd /opt/ai-marketing-agent-staging
git fetch && git reset --hard origin/main
bash scripts/deploy-staging.sh          # --check 仅做前置检查
```
