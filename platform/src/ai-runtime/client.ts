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
    this.fetchImpl = options.fetchImpl ?? fetch;
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

  /** Synchronous batch classification for imported items (iteration-1 tagging). */
  async classifyItems(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(new URL('/internal/classify', this.options.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': this.options.internalToken },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
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
      // 证据包最大 ~40 条 × 600 字 + 标签样本，flagship 档位生成可能显著更慢。
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) throw new Error(`AI runtime insight report failed: ${response.status}`);
    return await response.json() as Record<string, unknown>;
  }
}
