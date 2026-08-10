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
}
