## AI Agent Automation Platform Product Architecture — MVP Baseline v0.2

> Date: 2026-07-24
> Working name: **Piggybot**（social automation base + Zapier-style task automation + AI agent governance）  
> Status: 产品范围与服务边界已确认。本文定义 MVP 的产品契约；服务级实现边界见 `platform-run-service-ai-runtime-architecture.md`。

---

## 1. Executive Summary

Piggybot 是一个面向 **no-code users、增长团队、内容团队、代理商与开发者** 的 AI Agent Automation Platform。

它以 Zernio 的统一社交媒体 / 广告 / 评论私信 API 能力为基础，向外扩展为可视化自动化平台：用户不需要写 API 调用，也可以通过模板、自然语言 Copilot、可视化 Flow Builder，把“内容生成 → 审批 → 多平台发布 → 评论/DM 处理 → CRM/表格/IM 同步 → 广告优化 → 报告复盘”串成自动化工作流。

商业模式借鉴 Zapier 的 **task-based usage**：平台按自动化实际执行的成功动作计费，同时保留 Zernio 式“连接账号”成本锚点，形成 **Connected Account + Task Credit** 的混合定价模型。

核心定位：

> **The AI automation OS for social, marketing, and customer-engagement operations — starting from Zernio, expanding toward no-code agentic workflows.**

### 1.1 Resolved MVP baseline

MVP 不是一个泛化的 “Zapier + agents” 平台。第一版只验证一个闭环：

```text
手动或定时触发 → AI 生成/改写 → 人工审批 → 多平台排期或发布 → timeline、audit 与 task 计量
```

第一批模板为：内容改写并排期、每周增长报告、评论意图分流。广告预算修改、全自动 DM 回复、任意 HTTP action 和 connector marketplace 均不属于首个可售 MVP。

产品由五个部署边界组成：`frontend`、`gateway`、`run-service`、`connector-service`、`ai-runtime`。前端只访问 Gateway，外部副作用只能经 Connector Service，平台 run 的状态与计费事实只能由 Run Service 写入。

---

## 2. Source Product Observations

### 2.1 Zernio — Key Strengths

基于公开页面与 LLM 文档观察，Zernio 当前更像 developer-first infrastructure：

- 统一 REST API：一套认证与请求结构，覆盖 15+ 社交平台。
- 覆盖平台：Instagram、TikTok、YouTube、X/Twitter、LinkedIn、Facebook、Threads、Pinterest、Reddit、Bluesky、WhatsApp、Telegram、Discord、Snapchat、Google Business 等。
- 广告能力：Meta Ads、Google Ads、TikTok Ads、LinkedIn Ads、Pinterest Ads、X Ads。
- 社交运营核心闭环：发布 / 定时 / 分析 / 评论 / 私信。
- MCP server：适合 AI agents 作为工具调用。
- 定价：前 2 个连接账号免费，之后按连接账号阶梯收费；每个账号包含 scheduling、analytics、inbox、API access、unlimited posts。

Zernio 的战略价值：它是一个高杠杆的 social/ads action layer，可作为 agentic automation 的底层工具层。

### 2.2 Zernio — Gaps / Extension Opportunities

- 对 no-code 用户不够友好：官网也明确偏 developer / technical teams。
- 缺少可视化自动化画布、模板市场、业务流程抽象。
- 缺少跨 SaaS 生态连接器网络：例如 CRM、Sheets、Notion、Slack/Feishu、ecommerce、support desk。
- 缺少面向组织的 agent governance：审批、权限、审计、团队空间、策略控制。
- 定价按 connected social account 计，和“自动化创造价值”的用量关系不完全一致。

### 2.3 Zapier — Key Strengths

基于 Zapier 公开页面观察：

- 连接 9,000+ apps，是横向连接器网络与自动化入口。
- 重点已从传统 Zap workflow 扩展到 AI workflows、agents、apps 与 governance。
- 强调 IT 可治理：action restrictions、managed connections、domain restrictions、app access controls、RBAC、SCIM、audit/log streaming。
- 强调可见性：每个 AI action / workflow / model call 都可追踪。
- 商业模式长期围绕 task-based usage：用户按成功自动化动作消耗任务额度，易理解且与价值创造绑定。

### 2.4 Zapier — Gaps / Differentiation Space

- 横向连接非常强，但在垂直场景（social growth、creator ops、ads automation、DM lead ops）深度不如专门 API 平台。
- AI agent 能力需要和具体高频业务场景结合，纯横向平台容易让 no-code 用户面对空白画布。
- 对 social/ads/inbox 的 agentic closed-loop 可以更深，例如“自动从评论发现商机 → 回复 → 写入 CRM → 生成再营销 audience → 更新广告策略”。

---

## 3. Product Thesis

Piggybot 不应该简单做“Zapier for social”。更好的切入是：

1. **Vertical first**：先在 social / content / ads / DM / creator ops 做深。
2. **No-code front-end**：把 Zernio 的 API/MCP 能力包装成模板化、可视化、自然语言驱动的工作流。
3. **Agent-native runtime**：不是传统 if-this-then-that，而是允许 AI agents 在边界内规划、调用工具、总结、请求审批。
4. **Task-based economics**：用 task credits 衡量自动化消耗和用户价值。
5. **Governance as moat**：所有 agent actions 可审批、可追踪、可回滚、可计费。

一句话：

> 从 Zernio 的统一社交 API 出发，构建一个“面向营销与客户互动场景的 Agentic Zapier”。

---

## 4. Target Users and Jobs-to-be-Done

### 4.1 Primary Personas

1. **No-code Creator / Solopreneur**
   - 不会写 API，但需要多平台发内容、回复评论、复盘数据。
   - 购买动机：节省时间、降低多平台运营复杂度。

2. **SMB Marketing Team**
   - 需要内容日历、审批、多平台发布、线索同步。
   - 购买动机：统一团队流程、减少人工 copy/paste。

3. **Agency / Social Media Manager**
   - 管理多个客户与大量账号。
   - 购买动机：多 workspace、多品牌、多账号、报告自动化、利润率提升。

4. **Developer / AI Builder**
   - 需要 API、webhook、MCP tools、SDK，把社交/广告能力嵌入自有 agent。
   - 购买动机：节省对接平台 API 成本。

5. **Enterprise IT / Growth Ops**
   - 需要审批、权限、日志、策略、SSO、合规。
   - 购买动机：允许业务团队自动化，同时不失控。

### 4.2 Core Jobs

- “帮我把一篇内容改写成适合 LinkedIn、X、TikTok、Instagram 的版本，并排期发布。”
- “当 Instagram 评论里出现购买意图时，自动回复并把线索写进 HubSpot。”
- “每周生成跨平台增长报告，发到 Slack/飞书，并推荐下周内容主题。”
- “广告 CPL 超过阈值时提醒我，暂停低效 campaign 或请求审批。”
- “把 YouTube 视频转成短视频脚本、推文串和 newsletter 摘要。”

---

## 5. Product Scope

### 5.1 MVP Scope

MVP 目标：证明 no-code 用户愿意为 AI 社交自动化与 task-based usage 付费。

MVP 必须包含：

1. **Workspace & Identity**
   - 用户、团队、角色、品牌空间。

2. **Connected Accounts via Zernio**
   - 支持连接至少 5 个高频平台：Instagram、TikTok、YouTube、LinkedIn、X。
   - 展示账号状态、权限、同步状态。

3. **No-code Workflow Builder**
   - Trigger、Condition、Action、AI Step、Approval Step。
   - 支持模板启动，不强迫用户从空白画布开始。

4. **AI Copilot Builder**
   - 用户用自然语言描述需求，Copilot 生成 workflow draft。
   - 例：“每周五把本周表现最好的帖子总结成报告，发给团队。”

5. **Zernio Action Pack**
   - Create/schedule post。
   - Get analytics。
   - Read/reply comments。
   - Read/reply DMs（若平台支持）。

6. **Task Execution Engine**
   - workflow run、step run、retry、idempotency、queue、scheduler。
   - 每次成功 action 计入 task ledger。

7. **Human Approval & Audit Log**
   - 敏感动作如“公开发布、回复客户、修改广告预算”默认可配置审批。

8. **Billing & Usage Metering**
   - task credits、connected account count、overage、usage dashboard。

### 5.2 Non-MVP / Later Scope

- 完整 9,000+ app connector network。
- 自建广告投放优化 agent。
- Multi-agent collaboration。
- Enterprise SSO/SCIM。
- Full connector marketplace。
- Advanced BI warehouse and attribution modeling。
- Native mobile app。

### 5.3 MVP deliverables and explicit exclusions

| Deliverable | MVP requirement | Not in the first sellable release |
|---|---|---|
| Product UI | 登录后的 workspace、模板启动、简化的线性 workflow editor、run timeline、草稿审批、账号状态与 usage 页面 | 通用无限画布、统一 inbox、完整 social calendar、移动端 |
| Gateway | 身份认证、workspace RBAC、BrandProfile/Policy/context snapshot、面向用户的 API | 作为 workflow executor 或 connector credential owner |
| Run Service | durable Run/StepRun/ApprovalRequest/TaskEvent、DB-backed job worker、idempotency、retry、timeout、cancel、timeline | Temporal、多区域调度、任意步骤 replay UI |
| Connector Service | Zernio 账号连接/同步、能力矩阵、create/schedule post、analytics 与受限评论读取 | 完整 connector network、广告预算动作、自动 DM 发布 |
| AI Runtime | 内容规划/平台化草稿/合规建议/结构化 action plan、模型调用 trace | 长期记忆 source of truth、直接的社交 API 调用、用户态 API |
| Metering & audit | 成功的外部 action 与 AI step 产生不可变 TaskEvent/AuditEvent；workspace usage 汇总 | 完整 invoice/overage 自动扣款与高级成本预测 |

**Approval rule:** LLM 的合规结论只能提供建议，不能解除人工审批。`required` 和 `auto_approve` 都保留审批门；只有 Gateway/Run Service 明确授权并审计的 `none` policy 才能跳过审批。

---

## 6. Product Architecture

```mermaid
flowchart TD
  U[No-code User / Team] --> UX[Web App: Canvas + Templates + Copilot]
  UX --> GW[Gateway]
  GW --> MEM[Brand Context / Policy Store]
  GW --> RS[Run Service]
  GW --> CONN[Connector Service: account management]

  RS --> Q[Postgres Job / Outbox Worker]
  Q --> AIR[AI Runtime]
  Q --> CONN
  AIR --> LLM[Model Adapter / BYOM]
  AIR --> GUARD[Structured-output Guardrails / Evaluation]

  CONN --> Z[Zernio Adapter]
  CONN --> APPS[External App Connectors]
  Z --> SOCIAL[Social Platforms / Ads / Inbox]
  APPS --> SAAS[CRM / Sheets / Slack / Feishu / Notion / Ecommerce]

  RS --> LEDGER[Task Ledger]
  RS --> AUDIT[Audit Log]
  LEDGER --> BILL[Billing Engine]
  AUDIT --> OBS[Observability / Log Streaming]
```

### 6.1 Layer 1 — Experience Layer

Components:

- **Template Gallery**：按场景分类，如 Content Repurposing、Lead Capture、Weekly Report、Comment Auto-reply。
- **Visual Flow Builder**：节点式画布，支持 trigger / action / AI / condition / approval。
- **AI Copilot Builder**：自然语言生成 workflow draft，并解释每一步。
- **Social Calendar**：内容排期视图，连接 Zernio schedule API。
- **Unified Inbox**：聚合 comments / DMs，可触发 automation。
- **Usage Dashboard**：task credits、connected accounts、run success rate、error rate。

Design principle:

> No-code 用户看到的是“业务场景”和“结果”，不是 API endpoint。

### 6.2 Layer 2 — Workflow Orchestration Layer

Responsibilities:

- 解析并版本化 workflow definition；只执行已发布版本。
- 监听 triggers：schedule、webhook、social event、manual run、analytics threshold。
- 管理 execution state：pending、queued、running、waiting_approval、succeeded、failed、cancelled、timed_out、dead_lettered。
- 执行 condition、branch、loop、delay、retry。
- 保证 idempotency：避免重复发布、重复回复、重复扣费。
- 用 Postgres job/outbox 表和 worker 实现 MVP 的异步执行、延迟、重试与 scheduler；后续再替换或补充专用 queue/Temporal。
- 生成幂等的 task usage events，成功外部动作才可计费。

Core concepts:

- Workflow：用户定义的自动化流程。
- Trigger：启动条件。
- Step：执行节点。
- Run：一次 workflow 执行。
- StepRun：单个 step 的执行记录。
- TaskEvent：可计费动作事件。

### 6.3 Layer 3 — Agent Runtime Layer

Responsibilities:

- Planner：把用户目标拆成可执行步骤。
- Planner：产出受 schema 约束的 proposed action plan；不持有 connector credential，也不直接调用外部副作用 action。
- Memory：只消费 Gateway 传入的 brand voice、历史表现、客户偏好与 approved templates snapshot；不持有长期 source of truth。
- Model adapter：AI Runtime 内的 provider abstraction，支持 OpenAI / Anthropic / Gemini / Bedrock / self-hosted endpoint。Gateway 决定 workspace 可用模型与预算 policy；Run Service 记录模型调用的 usage/audit 事实。
- Guardrails：PII 检测、品牌安全、敏感动作审批、输出校验。
- Evaluation：对自动回复、内容生成、广告建议进行评分与追踪。

Agent modes:

1. **Copilot Mode**：只建议，不自动执行。
2. **Assisted Automation**：Run Service 自动推进低风险的 preparation step；高风险或外部动作请求审批。
3. **Autopilot**：仅由 Run Service 在明确 policy sandbox 内调度已允许的确定性 connector action。

### 6.4 Layer 4 — Integration Layer

#### Zernio Adapter

Maps Zernio capabilities into no-code actions:

- `social.create_post`
- `social.schedule_post`
- `social.get_post_status`
- `social.retry_failed_post`
- `social.get_analytics`
- `social.read_comments`
- `social.reply_comment`
- `social.read_dm`
- `social.reply_dm`
- `ads.list_campaigns`
- `ads.pause_campaign`
- `ads.update_budget`（approval recommended）

#### External Connectors

MVP connectors should be fewer but high-value:

- Google Sheets / Airtable：记录内容日历、线索、报告。
- HubSpot / Salesforce：CRM lead sync。
- Slack / Feishu / Discord：审批、通知、报告。
- Notion / Google Docs：内容库与 SOP。
- Webhook / HTTP：通用扩展。

### 6.5 Layer 5 — Governance Layer

Governance is not an enterprise-only add-on; it is the foundation for agent trust.

Capabilities:

- Workspace-level RBAC。
- Managed connections：团队拥有账号凭据，成员不直接接触 token。
- Action restrictions：限制某些 workflow 可调用的动作。
- Approval policy：按动作、金额、平台、品牌、用户角色触发审批。
- Audit log：记录每次 AI decision、tool call、input/output、task cost。
- Secret vault：OAuth token、API key 加密保存。
- Data retention policy：不同 workspace 可配置保留周期。

### 6.6 Layer 6 — Billing and Metering Layer

Billing objects:

- Connected social accounts。
- Task credits。
- AI token cost / premium AI steps。
- Add-ons：advanced analytics、enterprise governance、extra workspaces。

每次执行产生日志：

```json
{
  "task_event_id": "te_123",
  "workspace_id": "ws_123",
  "workflow_run_id": "run_123",
  "step_run_id": "sr_123",
  "action_type": "social.schedule_post",
  "billable_units": 1,
  "status": "succeeded",
  "created_at": "2026-07-01T20:00:00+08:00"
}
```

`TaskEvent` 是 append-only ledger，不得由前端或 AI Runtime 直接写入。Run Service 在 connector 成功结果或已记录的 AI-step completion 后写入，并以 `runId + stepId + attempt + actionType` 去重。

---

## 7. Task-Based Pricing Model

### 7.1 Pricing Principle

Zernio 的账号定价适合 developer infrastructure；Zapier 的 task 定价适合 no-code automation。Piggybot 应采用混合模型：

> **Platform subscription + included connected accounts + included task credits + overage tasks.**

这样既覆盖底层社交平台连接成本，也让用户为实际自动化价值付费。

### 7.2 What Counts as a Task

Recommended billing rule:

- Trigger polling / webhook receiving：0 task。
- Filter / condition：0 task。
- Formatter / simple transform：0 task 或 0.1 internal unit（不对用户展示）。
- Successful external action：1 task。
- AI generation / classification：1–3 tasks，取决于模型成本与复杂度。
- Multi-platform post：每个平台发布算 1 task。
- Human approval notification：0 task；approval 后执行的动作才计 task。
- Failed step：不计 task，除非失败来自第三方成功接收后的异步失败，需要单独规则。

Examples:

1. “把一篇内容发布到 LinkedIn + X + Instagram”：3 tasks。
2. “AI 改写一篇内容 + 排期到 3 个平台”：1 AI task + 3 publish tasks = 4 tasks。
3. “读取评论并分类 100 条，自动回复 10 条”：classification 可按批次 1–5 tasks，10 replies = 10 tasks。

### 7.3 Draft Packaging

| Plan | Target user | Monthly price | Included accounts | Included tasks | Notes |
|---|---:|---:|---:|---:|---|
| Creator | Solo no-code user | $19 | 1 | 3,000 | Content scheduling + AI templates |
| Growth | SMB team | $49 | 10 | 10,000 | Team workflows + approvals |
| Agency | Multi-client ops | $149 | 30 | 50,000 | Workspaces + client reports |

Overage draft:

- Extra social account: $1–$6/account/month depending volume and platform cost。
- Extra tasks: $10 per 10,000 standard tasks as starting benchmark。
- Premium AI tasks: multiplier, e.g. frontier-model generation = 3 standard tasks。

---

## 8. Core Workflows

### 8.1 Workflow A — AI Content Repurposing and Scheduling

User story:

> As a creator, I paste one long-form idea and want AI to generate platform-native versions, ask for approval, and schedule across platforms.

Steps:

1. Manual trigger：paste source content。
2. AI Step：detect topic, tone, audience。
3. AI Step：generate variants for LinkedIn, X, Instagram, TikTok script。
4. Approval Step：user approves / edits。
5. Zernio Action：schedule posts。
6. Notification：send calendar summary to Slack/Feishu。
7. Task ledger：AI generation + each platform schedule counted。

### 8.2 Workflow B — Comment-to-Lead Automation

User story:

> As a growth marketer, I want buying-intent comments to become CRM leads automatically.

Steps:

1. Trigger：new comment from Zernio inbox。
2. AI Step：classify intent, sentiment, urgency。
3. Condition：intent = purchase / demo / pricing。
4. Action：reply with approved template or request approval。
5. Action：create/update lead in HubSpot。
6. Notification：send hot lead alert to sales channel。

### 8.3 Workflow C — Weekly Growth Report

User story:

> As an agency manager, I want every client to receive an automatic weekly report.

Steps:

1. Schedule trigger：Monday 9:00。
2. Zernio Action：fetch analytics across accounts。
3. AI Step：summarize wins, losses, recommendations。
4. Action：write report to Google Docs/Notion。
5. Action：send to client email/Slack/Feishu。
6. Audit：record all data sources and generated text。

### 8.4 Workflow D — Ads Guardrail Assistant

User story:

> As a budget owner, I want AI to flag underperforming campaigns and ask before pausing them.

Steps:

1. Schedule trigger：daily。
2. Zernio Ads Action：fetch campaigns。
3. Condition：CPL > threshold or ROAS < threshold。
4. AI Step：explain probable reason。
5. Approval Step：pause / reduce budget / ignore。
6. Zernio Ads Action：execute approved change。

---

## 9. Domain Model

```mermaid
erDiagram
  Workspace ||--o{ UserMembership : has
  Workspace ||--o{ BrandProfile : owns
  Workspace ||--o{ ConnectedAccount : connects
  Workspace ||--o{ Workflow : owns
  Workflow ||--o{ WorkflowStep : contains
  Workflow ||--o{ WorkflowRun : executes
  WorkflowRun ||--o{ StepRun : contains
  StepRun ||--o{ TaskEvent : emits
  Workspace ||--o{ Agent : configures
  Agent ||--o{ AgentMemory : uses
  Workspace ||--o{ Policy : enforces
  StepRun ||--o{ ApprovalRequest : may_create
  Workspace ||--o{ AuditEvent : records
  Workspace ||--o{ BillingAccount : bills
```

Key entities:

- `Workspace`：组织 / 团队 / 代理商客户空间。
- `BrandProfile`：品牌声音、目标受众、禁用词、审批规则。
- `ConnectedAccount`：Zernio social account 或外部 SaaS credential。
- `Workflow`：自动化定义。
- `WorkflowStep`：trigger / action / condition / AI / approval。
- `WorkflowRun`：一次执行。
- `TaskEvent`：计费事件。
- `Agent`：AI agent 配置，包括模型、工具权限、memory scope。
- `Policy`：动作限制、审批规则、数据权限。
- `AuditEvent`：不可篡改的运行日志。

---

## 10. API Surface Draft

### 10.1 Workflow APIs

```http
POST /api/workflows
GET /api/workflows
GET /api/workflows/{workflowId}
PATCH /api/workflows/{workflowId}
POST /api/workflows/{workflowId}/publish
POST /api/workflows/{workflowId}/run
GET /api/workflow-runs/{runId}
```

### 10.2 Connector APIs

```http
GET /api/connectors
GET /api/connectors/zernio/accounts
POST /api/connectors/zernio/connect
DELETE /api/connectors/{connectionId}
```

### 10.3 Agent APIs

```http
POST /api/agents
POST /api/agents/{agentId}/draft-workflow
POST /api/agents/{agentId}/test-step
GET /api/agents/{agentId}/memories
```

### 10.4 Billing APIs

```http
GET /api/billing/usage
GET /api/billing/task-events
GET /api/billing/forecast
POST /api/billing/checkout
```

---

## 11. Security, Reliability, and Compliance

### 11.1 Security Baseline

- OAuth credentials encrypted at rest。
- API keys shown only once。
- Workspace-scoped secret vault。
- Least-privilege connector scopes。
- Role-based access to workflows and credentials。
- Mandatory approval option for public publishing, DM replies, ad budget changes。
- PII redaction in logs by default。

### 11.2 Reliability

- Queue-based execution with retry/backoff。
- Idempotency key per external action。
- Dead-letter queue for stuck jobs。
- Provider-specific rate-limit handling。
- Circuit breaker per connector。
- Replayable workflow runs for debugging。

### 11.3 Observability

- Run timeline。
- Step input/output diff。
- Tool call trace。
- Model call trace。
- Task billing trace。
- Error taxonomy：auth_error、rate_limited、validation_error、provider_error、policy_blocked。

---

## 12. MVP Development Roadmap

### Phase 0 — Discovery and Prototype（2 weeks）

- Validate 5–8 high-frequency templates with target users。
- Build clickable flow builder prototype。
- Confirm billing vocabulary：task、AI task、connected account。

### Phase 1 — Core Platform Foundation（4–6 weeks）

- Gateway authentication, workspace RBAC, BrandProfile and Policy context snapshot。
- Run/StepRun/ApprovalRequest/TaskEvent/AuditEvent schema, DB-backed worker and outbox。
- Zernio connector service: connect/sync accounts plus create/schedule post。
- Minimal authenticated UI: templates, run creation, timeline and approval inbox。

### Phase 2 — AI Copilot and Templates（4 weeks）

- AI Runtime integration: structured content plan/drafts/action plan, guardrails and model trace。
- Natural-language-to-workflow draft limited to supported template primitives。
- Template gallery, human approval and basic analytics report generator。

### Phase 3 — Growth / Agency Readiness（4–6 weeks）

- Multi-client workspaces。
- CRM + Sheets + Slack/Feishu connectors。
- Weekly report automation。
- Comment-to-lead workflow。
- Billing checkout and overage。

### Phase 4 — Governance and Enterprise（later）

- SSO/SCIM。
- Managed connections。
- Action restrictions。
- Log streaming。
- BYOM / private model gateway。

---

## 13. Technical Implementation Plan — Superpowers Handoff Outline

This document is a product architecture draft, not a coding implementation plan yet. If Marco approves the product direction, the next Superpowers phase should create a granular TDD implementation plan under:

`docs/plans/2026-07-01-zerflow-ai-mvp-implementation-plan.md`

Recommended engineering stack assumption:

- Frontend：Next.js / React / Tailwind / visual canvas library。
- Backend：Node.js / TypeScript / Postgres / Redis / queue workers。
- Workflow Engine：custom lightweight orchestrator first; Temporal later if complexity grows。
- AI Layer：model gateway abstraction + tool registry + policy middleware。
- Billing：Stripe + internal task ledger。
- Observability：OpenTelemetry + structured logs。

First implementation epics:

1. Workflow schema and validator。
2. Execution engine with step runner。
3. Zernio connector action pack。
4. Task ledger and billing usage calculation。
5. No-code builder MVP。
6. AI workflow draft generator。
7. Approval and audit log。

---

## 14. Key Product Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| No-code users find agents unpredictable | Trust barrier | Approval-first UX, explain every step, dry-run mode |
| Social platforms have inconsistent API behavior | Delivery reliability | Zernio adapter hides provider differences, per-platform capability matrix |
| Task pricing feels confusing | Conversion barrier | Show live task estimate before enabling workflow |
| AI output can damage brand | Reputation risk | Brand voice memory, forbidden topics, approval policies |
| Zapier can copy horizontal features | Competitive pressure | Build vertical depth in social/ads/inbox workflows |
| Zernio dependency risk | Platform coupling | Adapter abstraction; allow direct provider connectors later |

---

## 15. Confirmed product decisions

1. **Target segment:** Agency / SMB social growth operations first; creator self-serve is a later packaging option.
2. **Initial connector set:** Zernio (Instagram, TikTok, YouTube, LinkedIn, X) is mandatory. Slack/Feishu and Google Sheets are the first non-social connectors. HubSpot and Notion/Google Docs follow after the core posting loop works.
3. **Autonomy:** approval-first. Low-risk draft generation may be automatic, but public publishing, replies and ad changes require a policy decision and normally human approval.
4. **Commercial model:** Growth/Agency revenue first, with connected accounts plus task credits. Billing records are generated by Run Service, never inferred from UI analytics.
5. **Build strategy:** standalone SaaS with an adapter boundary around Zernio. No direct Zernio calls from the browser or AI Runtime.
6. **MVP reliability:** a Postgres-backed worker/outbox is required from the first production release. A separate queue broker and Temporal are deferred, not the durable run model itself.
