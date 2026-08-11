import { Controller } from 'egg';

import { HttpError } from '../../src/http/errors';

export default class PlatformController extends Controller {
  async health(): Promise<void> { this.ctx.body = { ok: true, service: 'gateway' }; }

  async runtimeEvent(): Promise<void> {
    const rawBody = (this.ctx.state as { rawBody?: Buffer }).rawBody;
    if (!rawBody) throw new HttpError(401, 'unauthorized');
    this.app.platform.service.verifyAiRuntimeSignature(rawBody, this.ctx.get('x-ai-runtime-signature'));
    await this.app.platform.service.ingestAiRuntimeEvent(this.ctx.request.body);
    this.ctx.status = 202;
    this.ctx.body = { accepted: true };
  }

  async createRun(): Promise<void> {
    const created = await this.app.platform.service.createWorkflowRun(this.actor(), this.ctx.request.body);
    this.ctx.status = 202;
    this.ctx.body = created;
  }

  async createStripeCheckout(): Promise<void> {
    this.ctx.body = await this.app.platform.service.createStripeCheckout(this.actor(), this.ctx.request.body);
  }

  async stripeWebhook(): Promise<void> {
    const rawBody = (this.ctx.state as { rawBody?: Buffer }).rawBody;
    if (!rawBody) throw new HttpError(400, 'invalid_request');
    this.ctx.body = await this.app.platform.service.ingestStripeWebhook(rawBody.toString('utf8'), this.ctx.get('stripe-signature'));
  }

  async publishTemplate(): Promise<void> {
    this.ctx.status = 201;
    this.ctx.body = await this.app.platform.service.publishTemplate(this.actor(), this.ctx.params.templateId);
  }

  async connectZernio(): Promise<void> { this.ctx.body = { url: this.app.platform.service.connectUrl(this.actor()) }; }

  async zernioCallback(): Promise<void> {
    const { code, state } = this.ctx.query;
    if (!code || !state) throw new HttpError(400, 'invalid_request');
    await this.app.platform.service.completeZernioOAuth(code, state);
    this.ctx.type = 'html';
    this.ctx.body = '<!doctype html><title>Piggybot</title><p>Zernio account connected. You may close this window.</p>';
  }

  async syncZernio(): Promise<void> { this.ctx.body = await this.app.platform.service.syncZernio(this.actor()); }
  async approvals(): Promise<void> { this.ctx.body = await this.app.platform.service.pendingApprovals(this.actor()); }

  async run(): Promise<void> {
    const run = await this.app.platform.service.run(this.actor(), this.ctx.params.runId);
    if (!run) throw new HttpError(404, 'run_not_found');
    this.ctx.body = run;
  }

  async decideApproval(): Promise<void> {
    const body = (this.ctx.request.body ?? {}) as { reason?: unknown };
    this.ctx.body = await this.app.platform.service.decideApproval(this.actor(), this.ctx.params.approvalId, this.ctx.params.decision, body.reason);
  }

  async taskEvents(): Promise<void> { this.ctx.body = await this.app.platform.service.taskEvents(this.actor()); }
  async billingUsage(): Promise<void> { this.ctx.body = await this.app.platform.service.billingUsage(this.actor()); }
  async referralLink(): Promise<void> { this.ctx.body = await this.app.platform.service.referralLink(this.actor()); }
  async referralSummary(): Promise<void> { this.ctx.body = await this.app.platform.service.referralSummary(this.actor()); }
  async updateBillingEntitlements(): Promise<void> {
    this.ctx.body = await this.app.platform.service.updateBillingEntitlements(
      this.actor(),
      this.ctx.get('x-billing-admin-token'),
      this.ctx.request.body,
    );
  }
  async auditEvents(): Promise<void> { this.ctx.body = await this.app.platform.service.auditEvents(this.actor()); }
  async feedback(): Promise<void> {
    this.ctx.status = 201;
    this.ctx.body = await this.app.platform.service.createFeedback(this.actor(), this.ctx.request.body);
  }

  private actor() { return this.app.platform.service.actorFrom(this.ctx.get('authorization')); }
}
