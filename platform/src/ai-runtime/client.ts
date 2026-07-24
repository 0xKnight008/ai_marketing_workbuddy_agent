export interface AiRuntimeClientOptions {
  baseUrl: string;
  internalToken: string;
  fetchImpl?: typeof fetch;
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
    });
    if (!response.ok) throw new Error(`AI runtime request failed: ${response.status}`);
    return await response.json() as { aiRunId: string; status: 'accepted' };
  }
}
