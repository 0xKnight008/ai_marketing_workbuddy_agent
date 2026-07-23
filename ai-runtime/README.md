# Piggybot AI-Runtime

基于 Mastra 的 AI 执行面（架构文档 `platform-run-service-ai-runtime-architecture.md` §3.5 的实现）。

ai-runtime 只负责 **AI 规划与结构化生成**：接收 run-service 准备好的输入与执行上下文，产出草稿（draft）、合规检查结果（compliance）和多步骤执行计划（action plan）。它不持有组织记忆、connector 凭证，也不执行任何外部社交平台副作用动作。

## 模块结构

```text
src/
├── mastra/index.ts                        # Mastra 实例：注册 workflows / agents / storage / 内部路由
├── workflows/
│   ├── prepare-announcement-workflow.ts   # 四步流水线：规划 → 文案 → 合规 → action plan
│   └── step-events.ts                     # ai_step.* 事件包装器
├── agents/
│   ├── announcement-planner-agent.ts      # 内容规划（每平台切入角度与要点）
│   ├── copy-optimization-agent.ts         # 文案优化（平台化草稿）
│   └── compliance-checker-agent.ts        # 语义合规校验
├── schemas/
│   ├── announcement.ts                    # 输入/上下文/draft/action plan 结构化 schemas
│   └── events.ts                          # ai-runtime → run-service 事件契约（§7）
├── events/
│   └── emitter.ts                         # 事件发射器：HMAC 签名 + 指数退避重试
├── internal-api/
│   ├── routes.ts                          # 业务友好内部路由（§5.4）
│   ├── run-registry.ts                    # LibSQL 持久化 aiRunId ↔ platformRunId 注册表
│   └── auth.ts                            # x-internal-token 共享密钥鉴权
├── lib/
│   ├── approval-policy.ts                 # 人工审批门控策略
│   ├── deterministic-checks.ts            # 确定性执行时校验（禁用词/长度/字数）
│   └── target-validation.ts               # 校验模型输出不改变投递目标
└── config.ts                              # 环境配置
```

## API

均挂载在 Mastra Server 上（默认 `:4111`），`/internal/*` 需要 `x-internal-token` 头：

| Method | Path | 说明 |
|---|---|---|
| GET | `/internal/health` | 健康检查（无需鉴权） |
| POST | `/internal/ai-runs/prepare-announcement` | 提交公告准备任务，返回 `202 { aiRunId, status: "accepted" }` |
| GET | `/internal/ai-runs/{aiRunId}` | 轮询 run 状态；`succeeded` 时携带完整 `{ contentPlan, drafts, compliance, actionPlan }` |

请求契约见架构文档 §5.4；事件契约（`ai_run.*` / `ai_step.*` / `draft.created` / `action_plan.created`）见 §7。

## Workflow：prepare-announcement-workflow

```text
content-planning        planner agent 产出 ContentPlan（每平台角度/要点/CTA）
  → copy-optimization   copy agent 产出 DraftSet（平台化草稿 + hashtags + characterCount）
  → compliance-check    确定性校验（禁用词/长度上限）+ agent 语义校验 → ComplianceReport
  → build-action-plan   生成多步骤 action plan（幂等键 `{runId}:post:{platform}:{accountId}`）
```

审批策略（`executionContext.approvalPolicy`）：

- `required`：所有 action `requiresApproval=true`
- `auto_approve`：语义合规由 LLM 评估，属于建议而非可信放行信号；当前实现仍要求人工审批
- `none`：免审批

## 快速开始

```bash
node --version # requires v22.13.0 or newer
cp .env.example .env   # 配置 AI_MODEL / OPENAI_API_KEY / INTERNAL_API_TOKEN
corepack enable
pnpm install --frozen-lockfile
pnpm run dev           # mastra dev，默认 :4111
```

质量检查：

```bash
pnpm run typecheck
pnpm test
```

依赖版本被固定到本实现使用的 Mastra 1.4 API；升级 Mastra 时应先升级并通过以上检查，
再更新版本号与 lockfile，避免包管理器在全新安装时静默选中不兼容的 API 版本。

冒烟测试：

```bash
curl -X POST http://localhost:4111/internal/ai-runs/prepare-announcement \
  -H 'content-type: application/json' \
  -H 'x-internal-token: dev-internal-token' \
  -d '{
    "platformRunId": "run_123",
    "workspaceId": "ws_123",
    "actorId": "user_123",
    "input": {
      "mode": "draft",
      "brief": "发布新功能公告",
      "targets": [{ "platform": "telegram", "accountId": "acc_123" }]
    },
    "executionContext": {
      "brandProfile": { "tone": "clear, concise, helpful", "forbiddenWords": ["guaranteed"] },
      "approvalPolicy": "required"
    },
  }'
```

## 部署注意（§10 / §12）

- 生产环境必须将 `MASTRA_STORAGE_URL` 配置为共享 LibSQL endpoint（例如 Turso）；本地 `file:` storage 会在启动时被拒绝。
- 事件只投递到 `RUN_SERVICE_CALLBACK_URL`，不接受请求里的 callback URL，避免 SSRF。
- 内部 API 仅暴露给可信服务；`INTERNAL_API_TOKEN` 必须配置，否则内部路由拒绝服务。
- Mastra Studio 只指向 staging（`MASTRA_STUDIO_ENABLED`）。
- 事件 callback 失败只重试不中断 workflow，run-service 可用轮询接口兜底；配置了 `EVENT_CALLBACK_SIGNING_SECRET` 时请求带 `x-ai-runtime-signature`（HMAC-SHA256）。
- run 注册表持久化在配置的 LibSQL storage 中，支持跨实例轮询与进程重启恢复；run-service 的 `AIRuntimeRunMapping` 仍是长期 source of truth。
