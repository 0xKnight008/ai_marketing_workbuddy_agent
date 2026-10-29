# 三档 LiteLLM 路由、Standard 输出及请求追踪

Standard/Flagship 更换为 1Token GPT/Opus 后，请使用 [新的迁移文档](ONETOKEN_STANDARD_FLAGSHIP_MIGRATION.md)。本页保留原始 Z.AI 迁移记录；旧脚本会拒绝已切换的 onetoken profile。

本次发布增加 `AI_MODEL_ROUTING_MODE=litellm`。普通部署仍使用服务器现有环境；下面的人工切换才会改变路由。先 Standard + Flagship，验证后再加入 Eco。订阅价格、credits 面值及 `shadow` 模式保持现状。禁止通过代理重试或 fallback 自动升级/降级模型。

## 修复及诊断边界

任务 `7d6e793f-9007-44f1-a8cb-4ddcee481512` 的 Z.AI 用量已返回，随后 Mastra 结构化解析报 `root: Required`。原请求只通过提示词约束 JSON。本次对官方 Eco/Standard 及其代理别名启用 `response_format: json_object`；任务响应在同一次生成后解析并校验，不调用第二个付费模型修复结果。兼容完整 JSON 代码围栏；空、截断、非 JSON、缺少必需字段继续失败并沿用退款链路。来源引用仍由 Platform 核验，不能把自由文本假装为成功结果。Flagship 保留原生 JSON Schema。

上游 token ledger 的 finish_reason 可能已被 SDK 解析错误改写。本次额外保存原始 HTTP 响应中的结束原因（固定枚举）、HTTP 状态、返回模型、内容长度及 LiteLLM call-id。没有保存提示词、生成正文、推理内容、密钥、完整 headers 或原始异常。

Runtime 使用现有 LibSQL 自动创建 `ai_request_trace` 和查询索引；这是新增诊断表，无 PostgreSQL migration，无历史账本重写。已有计费/退款及 RLS 不变。备份现有 LibSQL，日志按原有数据库备份/保留策略管理。

## 慢响应的 HTTP 超时修复

生产任务 `5ff6fc50-6d74-4d0c-88b4-a39e5ee945f2` 的第二个分类 chunk 在约 211 秒后成功返回，但 Mastra 默认的 180 秒 HTTP deadline 已经结束请求。迟到的结果随后被缓存为 `metered_execution_failed`。这与 Z.AI Standard API / Coding Plan 密钥类型无关；当前官方 Standard API 地址和密钥应继续使用。

修复后的默认层级为：LiteLLM Eco/Standard 900 秒 → Runtime 模型 HTTP 传输 930 秒 → Mastra HTTP server 960 秒 → Platform 同步 AI 请求 1200 秒。Flagship 的代理超时仍为 180 秒。两侧使用独立 Undici dispatcher，避免原生 fetch 的 header/body 超时先于应用 deadline；模型请求同时保留总时长 AbortSignal，真正超时仍终止等待。

`AI_MODEL_HTTP_TIMEOUT_MS` 和 `AI_RUNTIME_REQUEST_TIMEOUT_MS` 可覆盖 Runtime 默认值（毫秒）；生产环境要求后者大于前者。Platform 如已有 `AI_RUNTIME_CLASSIFY_TIMEOUT_MS` / `AI_RUNTIME_INSIGHT_TIMEOUT_MS` / `AI_RUNTIME_TOPICS_TIMEOUT_MS` 自定义值，应确认它们大于 Runtime deadline。未设置时直接使用新默认值，无需改环境文件。`/internal/health` 返回实际 `modelHttpTimeoutMs` 和 `requestTimeoutMs`，用于验证新进程已经加载配置。

本修复无需数据库 migration、不改费率、不开启 cost-v1，也不会自动重跑历史失败任务。已有成功分类保留，失败预扣按既有退款链路处理；不删除幂等记录或财务记录。模型请求超过预算/输出限制仍会按原 guardrail 处理。

## 1. 部署代码并备份

待 PR 合并部署后，在服务器同一个 shell 执行以下命令。`NODE_BIN` 使用目前可用 Node 路径；不依赖以前终端定义的 shell 函数。

```bash
cd /opt/ai-marketing-agent
NODE_BIN="$(command -v node)"
"$NODE_BIN" --version
BACKUP_DIR="/etc/piggybot/backup-proxy-$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -m 0700 "$BACKUP_DIR"
sudo cp -p /etc/piggybot/platform.env "$BACKUP_DIR/platform.env"
sudo cp -p /etc/piggybot/ai-runtime.env "$BACKUP_DIR/ai-runtime.env"
sudo cp -p /etc/piggybot/litellm.env "$BACKUP_DIR/litellm.env"
# 保存当前生效的代理配置；首次迁移通常是发布目录的 config.yaml。
# 如果 LITELLM_CONFIG_FILE 已设定其他路径，请改成那个实际路径。
sudo cp -p deploy/litellm/config.yaml "$BACKUP_DIR/previous-config.yaml"
sudo chmod 0600 "$BACKUP_DIR/previous-config.yaml"
```

先等待正在执行的任务完成，并安排短维护窗口；运行中/已接受的旧任务持有旧费率快照，不应在其执行中切换模型别名。不要清空任务或财务表。

## 2. 准备候选文件（不改变服务）

```bash
CANDIDATE_DIR="/etc/piggybot/candidate-proxy-$(date -u +%Y%m%dT%H%M%SZ)"
sudo "$NODE_BIN" scripts/prepare-unified-proxy.mjs "$CANDIDATE_DIR" standard,flagship
sudo "$NODE_BIN" scripts/litellm-preflight.mjs "$CANDIDATE_DIR/proxy.env"
```

脚本从已有环境读取凭证，只写新目录，拒绝覆盖；复制全部三档费率、DeepSeek 时段/汇率，只更改模型标识和费率版本，并把已验证的 Standard/Flagship 费率写入候选 config.yaml。Runtime 使用候选中的 `AI_PROXY_BANDS=standard,flagship` 时 Eco 仍直连官方。

新配置将 Z.AI/DeepSeek 官方密钥交给 LiteLLM，仍调用原官方账号；不会转至 1Token。模板中的 Standard 单价为每百万 tokens 输入 $0.15、缓存 $0.03、输出 $0.50；Flagship gpt-6-sol 为 $2/$0.20/$10。确认模板仍符合当前合同。Eco 的 LiteLLM spend 使用其模型目录估算；Platform 仍按已确认人民币价格、6.7 汇率和时段快照记账，两者可能不同。供应商账单和 Platform 回执是财务验收依据。

已只读核实当前固定镜像：`zai/` 适配器未声明支持 response_format，因此 Standard 明确使用 `openai/glm-5.3-flash` 加 Z.AI 官方 api_base，支持 JSON 模式；Eco 的 `deepseek/` 适配器支持该参数。升级镜像仍须固定 digest 并复核参数支持，不能使用浮动 latest。

## 3. 配置持久代理与 virtual key

安装到 `/etc/piggybot` 后，下一次网站部署不会覆盖费率/代理配置。数据库密码、salt、master key 均沿用原值。

```bash
sudo install -m 0600 "$CANDIDATE_DIR/config.yaml" /etc/piggybot/litellm-config.yaml
sudo install -m 0600 "$CANDIDATE_DIR/proxy.env" /etc/piggybot/litellm.env
sudo docker compose --env-file /etc/piggybot/litellm.env -f deploy/litellm/compose.yaml config --quiet
sudo docker compose --env-file /etc/piggybot/litellm.env -f deploy/litellm/compose.yaml up -d proxy
```

在 LiteLLM 管理界面为 Runtime 创建/更新 virtual key，允许 `primary-eco`、`primary-standard`、`primary-flagship`。保留原 key 直到迁移验收完成。若使用新 key，通过 `sudoedit` 修改候选 `runtime.env` 的 `OPENAI_API_KEY`；不要把 key 粘贴到聊天或命令行参数。

```bash
sudoedit "$CANDIDATE_DIR/runtime.env"
sudo "$NODE_BIN" --env-file="$CANDIDATE_DIR/runtime.env" ai-runtime/scripts/check-unified-proxy.mjs
cd platform
sudo "$NODE_BIN" --env-file="$CANDIDATE_DIR/platform.env" --import tsx src/billing/metering-preflight.ts
cd ..
```

两个 preflight 都只读，不发模型生成请求。代理 `/health` 可能调用付费模型，使用 `/health/readiness`。模型列表可见仅证明权限/配置就绪，不能替代下一步真实任务验收。

## 4. 切换 Standard

在维护窗口、旧任务完成后同步安装平台和 Runtime 候选环境。若使用独立 worker 服务，也应同步重启该服务。

```bash
sudo systemctl stop piggybot-platform
sudo install -m 0600 "$CANDIDATE_DIR/platform.env" /etc/piggybot/platform.env
sudo install -m 0600 "$CANDIDATE_DIR/runtime.env" /etc/piggybot/ai-runtime.env
sudo systemctl restart piggybot-ai-runtime
sudo systemctl start piggybot-platform
curl --fail --silent --show-error http://127.0.0.1:4111/internal/health
curl --fail --silent --show-error http://127.0.0.1:4100/internal/ready
```

用户在产品内主动运行一个小 Standard 任务，检查导入、回答/追问、保存结果和证据引用。确认实际模型 glm-5.3-flash、代理 call-id、Z.AI token 与费率回执一致。失败时预扣额度应退回，已成功分类的费用按原规则保留。不要自动重新执行历史失败任务。

## 5. 加入 Eco

Standard 验收通过后，生成新的候选目录（不要复用旧目录）：

```bash
CANDIDATE_DIR="/etc/piggybot/candidate-all-proxy-$(date -u +%Y%m%dT%H%M%SZ)"
sudo "$NODE_BIN" scripts/prepare-unified-proxy.mjs "$CANDIDATE_DIR" eco,standard,flagship
sudo "$NODE_BIN" --env-file="$CANDIDATE_DIR/runtime.env" ai-runtime/scripts/check-unified-proxy.mjs
```

重复第 4 步同步安装 platform/runtime 环境，并在产品内验收 Eco 与 Flagship。所有档位保留 `shadow`；实际账单核对及 cost-v1 开启是单独的后续操作。观察代理共同故障点、Eco/Standard 900 秒与 Flagship 180 秒上游超时、队列积压；没有自动 fallback 或隐藏付费重试。

## 6. 按任务查询脱敏追踪

可按 task UUID、Runtime request UUID 或计费 operation UUID 查询。接口仅接受内部鉴权，不能暴露给公网或普通用户。

```bash
sudo "$NODE_BIN" --env-file=/etc/piggybot/ai-runtime.env --input-type=module - <<'JS'
const id = 'REPLACE_TASK_UUID';
const r = await fetch('http://127.0.0.1:4111/internal/request-traces?id=' + encodeURIComponent(id), {
  headers: {'x-internal-token': process.env.INTERNAL_API_TOKEN}
});
if (!r.ok) throw new Error('Trace query failed: ' + r.status);
console.log(JSON.stringify(await r.json(), null, 2));
JS
```

`details.attempts[].proxyCallId` 对应 LiteLLM request log；`failureCode` 是应用层输出校验结果。重放记录的 attempts 为空，原请求记录保留实际调用。LiteLLM audit log 记录管理操作，不能替代应用结果校验日志。

## 7. 回滚

等待在途任务结束，使用第 1 步的 `BACKUP_DIR` 同步恢复平台与 Runtime 环境。若要恢复代理配置，为保持今后部署安全，仍安装到服务器私有路径，然后在恢复的 litellm.env 中设置 `LITELLM_CONFIG_FILE=/etc/piggybot/litellm-config.yaml`。

```bash
sudo systemctl stop piggybot-platform
sudo cp -p "$BACKUP_DIR/platform.env" /etc/piggybot/platform.env
sudo cp -p "$BACKUP_DIR/ai-runtime.env" /etc/piggybot/ai-runtime.env
sudo cp -p "$BACKUP_DIR/litellm.env" /etc/piggybot/litellm.env
sudo install -m 0600 "$BACKUP_DIR/previous-config.yaml" /etc/piggybot/litellm-config.yaml
sudoedit /etc/piggybot/litellm.env
# 设置上述 LITELLM_CONFIG_FILE，然后：
sudo docker compose --env-file /etc/piggybot/litellm.env -f deploy/litellm/compose.yaml up -d proxy
sudo systemctl restart piggybot-ai-runtime
sudo systemctl start piggybot-platform
```

保留诊断表、token ledger 和账本，不删除历史费用记录。恢复旧 direct 配置后，本次 JSON 输出约束仍适用于 three-channel 的 Eco/Standard。

## 参考

- [Z.AI JSON mode](https://docs.z.ai/guides/capabilities/struct-output)
- [LiteLLM Z.AI provider](https://docs.litellm.ai/docs/providers/zai)
- [LiteLLM DeepSeek provider / cost estimation](https://docs.litellm.ai/docs/providers/deepseek)
- [LiteLLM request IDs and message redaction](https://docs.litellm.ai/docs/proxy/logging)
- [Custom pricing](https://docs.litellm.ai/docs/proxy/custom_pricing)
