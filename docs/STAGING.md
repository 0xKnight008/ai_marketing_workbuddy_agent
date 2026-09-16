# Staging：同机隔离栈 + 真实模型六模板验收

Staging 与生产共用 piggybot-2 主机，但每个 touchpoint 都是独立资源：
独立端口、独立数据库、独立 env 文件、独立 systemd 单元、独立 nginx 站点
（staging.piggybot.me）。脚本内置硬性防呆：任何指向生产路径、生产端口、
生产数据库或生产 systemd 单元的配置都会让脚本直接拒绝运行。

## 架构

| 资源 | 生产 | Staging |
|---|---|---|
| 站点 | piggybot.me（nginx → 容器 :8001） | staging.piggybot.me（nginx → 静态 dist） |
| Egg platform | 127.0.0.1:4100 / `piggybot-platform` | 127.0.0.1:4200 / `piggybot-platform-staging` |
| AI runtime | 127.0.0.1:4111 / `piggybot-ai-runtime` | 127.0.0.1:4211 / `piggybot-ai-runtime-staging` |
| 数据库 | `piggybot` | `piggybot_staging`（同一实例） |
| env 文件 | `/etc/piggybot/*.env` | `/etc/piggybot-staging/*.env` |
| 部署目录 | `/opt/ai-marketing-agent` | `/opt/ai-marketing-agent-staging` |
| 备份目录 | `/var/backups/piggybot` | `/var/backups/piggybot-staging` |

安全边界与生产一致：仅 80/443 对外；4200/4211 只绑定回环；`/internal/`
在公网 404；staging 密钥全部重新生成，绝不复用生产值（任一环境泄露
不会打开另一个环境）。staging 的 Stripe 只用 test 模式密钥。

## 一次性 provisioning

在主机上、仓库检出内执行：

```bash
bash scripts/provision-staging.sh
```

脚本幂等创建：env 文件（仅从示例安装，绝不覆盖已有文件）、
`piggybot_staging` 数据库、两个 systemd 单元（enable 不 start）、
nginx 站点（`nginx -t` 后不 reload）、备份目录。随时可用
`bash scripts/provision-staging.sh --check` 复核。

随后手工完成：

1. 填写 `/etc/piggybot-staging/platform.env` 与 `ai-runtime.env` 中的
   staging 密钥（文件内注释标明每项的生成方式；`openssl rand -hex 32` /
   `openssl rand -base64 32`）。真实模型验收需要 routing proxy 配置：
   与生产同一个 proxy 账号即可，但申请一把单独签发的 key 以便独立吊销。
2. Cloudflare 增加 `staging.piggybot.me` DNS 记录。**staging 不是公开面**：
   用 Cloudflare Access / WAF IP 白名单限制访问，或启用 nginx 配置里
   注释掉的 basic auth。
3. `sudo certbot --nginx -d staging.piggybot.me && sudo systemctl reload nginx`
4. 准备 staging 检出并部署：

   ```bash
   sudo mkdir -p /opt/ai-marketing-agent-staging
   sudo chown "$USER:$USER" /opt/ai-marketing-agent-staging
   git clone <repo> /opt/ai-marketing-agent-staging   # 或 git fetch && reset
   bash /opt/ai-marketing-agent-staging/scripts/deploy-staging.sh
   ```

## 日常部署

```bash
cd /opt/ai-marketing-agent-staging
git fetch && git reset --hard origin/main
bash scripts/deploy-staging.sh          # --check 仅做前置检查
```

流程与生产部署一致：platform/ai-runtime 的 `npm ci` + typecheck + 测试、
ai-runtime build、前端静态 build（`VITE_GATEWAY_URL` 留空，同源 `/api`）、
staging 数据库 pg_dump 备份（PGDMP 魔数校验）、停 staging platform →
migrate → db:check → 重启两个 staging 单元 → 4200/4211 健康检查。
失败时 ERR trap 只会重启 staging 单元；脚本从头到尾不引用任何生产单元、
容器或路径。

## 真实模型六模板验收

在主机上执行（需要 staging env 已填好、服务已部署）：

```bash
cd /opt/ai-marketing-agent-staging/platform
node scripts/staging-acceptance.mjs                    # 完整验收
node scripts/staging-acceptance.mjs --skip-failure-recovery   # 跳过故障注入
```

验收覆盖：

1. **健康检查** — platform `/internal/ready` 与 ai-runtime `/internal/health`。
2. **隔离工作区** — 每次运行新建工作区（agency 计划、active、足额 credits），
   用 `AUTH_TOKEN_SECRET` 在本地铸造 owner token（密钥不出主机）。
3. **全量管线** — 导入确定性 500 条 CSV 数据集（真实 LLM 分类），随后依次
   生成六个模板（content_recap / comment_insights / product_opportunities /
   review_attribution / community_digest / daily_ops，eco 档真实模型）。
4. **指标** — 每模板记录延迟、grounded 证据率（`_metrics.groundedRate`，
   默认下限 50%）、credits 记账（task_event 中该报告恰好 1 条
   `ai.insight` 扣费且大于 0）。
5. **失败恢复** — 停掉 `piggybot-ai-runtime-staging` 后发起报告，确认报告
   挂起而非失败；重启后确认报告完成且重试不重复扣费（幂等键回放）。
   需要 systemctl 的 non-interactive sudo 授权。

输出指标表 + PASS/FAIL，失败时退出码非零。阈值可用
`--min-grounded-rate` / `--max-latency-ms` 调整。

验收脚本绝不打印 env 值、token 或数据集内容。每次运行新建工作区，
staging 数据视为一次性；积累过多时直接重建数据库：

```bash
sudo docker exec <postgres容器> psql -U postgres -c \
  "DROP DATABASE piggybot_staging; CREATE DATABASE piggybot_staging;"
cd /opt/ai-marketing-agent-staging/platform
set -a; . /etc/piggybot-staging/platform.env 2>/dev/null || eval "$(sudo cat /etc/piggybot-staging/platform.env)"; set +a
npm run migrate && npm run db:check
```

## 故障排查

- `journalctl -u piggybot-platform-staging -u piggybot-ai-runtime-staging -f`
- 部署脚本报 `Refusing to run`：说明 env 里残留了生产值（端口/库名/URL），
  按报错逐项对照 `deploy/staging/*.env.example` 修正。
- 验收在分类阶段超时：500 条真实分类受 proxy 速率限制，属正常现象；
  可重跑（新工作区，互不影响）。
- 验收报告 `template_acceptance_failed`：与生产 worker 行为一致——模型
  输出未过模板验收时宁可失败也不注水；用 `--min-grounded-rate` 排查
  是证据率问题还是模板结构问题。
