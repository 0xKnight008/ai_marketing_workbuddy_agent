import { CostBudgetRequired, costContext, receiveCostReceipts } from '../billing/cost-metering';

// AI runtime call timeouts (ms). Tune for slow upstream LLM gateways:
// the routing proxy may take several minutes per chunk depending on
// model band and load. Defaults are 3-4x the worst observed latency.
const AI_RUNTIME_CLASSIFY_TIMEOUT_MS = Number(process.env.AI_RUNTIME_CLASSIFY_TIMEOUT_MS ?? 900_000);
const AI_RUNTIME_INSIGHT_TIMEOUT_MS = Number(process.env.AI_RUNTIME_INSIGHT_TIMEOUT_MS ?? 1_200_000);
const AI_RUNTIME_TOPICS_TIMEOUT_MS = Number(process.env.AI_RUNTIME_TOPICS_TIMEOUT_MS ?? 900_000);

export interface AiRuntimeClientOptions {
  baseUrl: string;
  internalToken: string;
  fetchImpl?: typeof fetch;
}

export interface AiRuntimeRun {
  aiRunId: string;
  platformRunId: string;
  workspaceId: string;
  status: 'accepted' | 'running' | 'succeeded' | 'failed';
  result?: Record<string, unknown>;
  error?: string;
}

export class AiRuntimeClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: AiRuntimeClientOptions) {
    const original=options.fetchImpl ?? fetch;
    this.fetchImpl=async(input,init)=>{
      const ctx=costContext.getStore();
      if(ctx?.envelope && init?.method==='POST' && init.body){const payload=JSON.parse(String(init.body));payload._metering=ctx.envelope;init={...init,body:JSON.stringify(payload)};}
      const response=await original(input,init);
      if(ctx){let data:any;try{data=await response.clone().json()}catch{data={}}
        if(data._metering)await ctx.database.withWorkspace(ctx.workspaceId,tx=>receiveCostReceipts(tx,ctx.workspaceId,data._metering));
        if(data.error==='ai_confirmed_budget_exhausted')throw new CostBudgetRequired(ctx.envelope?.band??'standard','ai_confirmed_budget_exhausted');
      }
      return response;
    };
  }

  async prepareAnnouncement(payload: Record<string, unknown>): Promise<{ aiRunId: string; status: 'accepted' }> {
    const response = await this.fetchImpl(new URL('/internal/ai-runs/prepare-announcement', this.options.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': this.options.internalToken },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`AI runtime request failed: ${response.status}`);
    return await response.json() as { aiRunId: string; status: 'accepted' };
  }

  async getAnnouncementRun(aiRunId: string): Promise<AiRuntimeRun> {
    const response = await this.fetchImpl(new URL(`/internal/ai-runs/${encodeURIComponent(aiRunId)}`, this.options.baseUrl), {
      headers: { 'x-internal-token': this.options.internalToken },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`AI runtime poll failed: ${response.status}`);
    return await response.json() as AiRuntimeRun;
  }

  async taskStep(payload:Record<string,unknown>):Promise<Record<string,unknown>> {
    const response=await this.fetchImpl(new URL('/internal/task-step',this.options.baseUrl),{method:'POST',headers:{'content-type':'application/json','x-internal-token':this.options.internalToken},body:JSON.stringify(payload),signal:AbortSignal.timeout(AI_RUNTIME_INSIGHT_TIMEOUT_MS)});
    if (!response.ok) {
      let data: any; try { data = await response.json(); } catch { data = {}; }
      const allowed = new Set(['task_output_truncated', 'task_output_filtered', 'task_output_incomplete', 'task_output_empty', 'task_output_invalid_json', 'task_output_invalid_schema', 'task_output_missing_content', 'task_step_failed']);
      const code = allowed.has(data.error) ? data.error : String(response.status);
      const id = typeof data.requestId === 'string' && /^[0-9a-f-]{36}$/i.test(data.requestId) ? ` (request ${data.requestId})` : '';
      throw new Error(`AI task step failed: ${code}${id}`);
    }
    return await response.json() as Record<string, unknown>;
  }

  /** Synchronous batch classification for imported items (iteration-1 tagging). */
  async classifyItems(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(new URL('/internal/classify', this.options.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': this.options.internalToken },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(AI_RUNTIME_CLASSIFY_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`AI runtime classify failed: ${response.status}`);
    return await response.json() as Record<string, unknown>;
  }

  /** Synchronous insight report generation from an aggregated evidence pack (iteration-2 templates). */
  async generateInsightReport(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(new URL('/internal/insight-report', this.options.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': this.options.internalToken },
      body: JSON.stringify(payload),
      // 证据包最大 ~64 条 × 600 字 + 标签样本，flagship 档位生成可能显著更慢。
      signal: AbortSignal.timeout(AI_RUNTIME_INSIGHT_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`AI runtime insight report failed: ${response.status}`);
    return await response.json() as Record<string, unknown>;
  }

  /** Topic taxonomy proposal from a bounded sample (Module 2 topic clustering). */
  async proposeTopics(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(new URL('/internal/topics/propose', this.options.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': this.options.internalToken },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(AI_RUNTIME_TOPICS_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`AI runtime topics propose failed: ${response.status}`);
    return await response.json() as Record<string, unknown>;
  }

  /** Topic assignment for one chunk against a fixed taxonomy (Module 2). */
  async assignTopics(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(new URL('/internal/topics/assign', this.options.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': this.options.internalToken },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(AI_RUNTIME_TOPICS_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`AI runtime topics assign failed: ${response.status}`);
    return await response.json() as Record<string, unknown>;
  }
}
