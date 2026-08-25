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

  async connectZernio(): Promise<void> {
    this.ctx.body = { url: await this.app.platform.service.connectUrl(this.actor(), this.ctx.query.platform) };
  }

  async zernioCallback(): Promise<void> {
    const result = await this.app.platform.service.completeZernioOAuth(this.ctx.query as Record<string, unknown>);
    this.ctx.type = 'html';
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.set('Referrer-Policy', 'no-referrer');
    this.ctx.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    this.ctx.body = result.kind === 'selection' ? selectionPage(result.platform, result.choices) : successPage();
  }

  async selectZernio(): Promise<void> {
    const body = (this.ctx.request.body ?? {}) as { selection?: unknown };
    await this.app.platform.service.selectZernioAccount(body.selection);
    this.ctx.type = 'html';
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.set('Referrer-Policy', 'no-referrer');
    this.ctx.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
    this.ctx.body = successPage();
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

function successPage(): string {
  return page('Account connected', '<p>Your social account is ready in Piggybot.</p><button type="button" onclick="window.close()">Close this window</button>');
}

function selectionPage(platform: string, choices: Array<{ label: string; detail?: string; token: string }>): string {
  const options = choices.map((choice, index) => `<label class="choice"><input type="radio" name="selection" value="${choice.token}" ${index === 0 ? 'checked' : ''} required><span><strong>${escapeHtml(choice.label)}</strong>${choice.detail ? `<small>${escapeHtml(choice.detail)}</small>` : ''}</span></label>`).join('');
  return page(`Choose your ${escapeHtml(platform)} account`, `<p>Choose the account Piggybot should use. This selection stays inside Piggybot.</p><form method="post" action="/api/zernio/select">${options}<button type="submit">Connect selected account</button></form>`);
}

function page(title: string, content: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title} · Piggybot</title><style>body{box-sizing:border-box;margin:0;min-height:100vh;padding:32px;background:#fffaf0;color:#172033;font:16px/1.5 system-ui,sans-serif}main{max-width:560px;margin:5vh auto;padding:28px;border:2px solid #172033;border-radius:18px;background:#fff}h1{margin-top:0;font-size:28px}.choice{display:flex;gap:12px;align-items:flex-start;margin:12px 0;padding:14px;border:1px solid #b8c2d0;border-radius:12px;cursor:pointer}.choice:has(input:checked){border-color:#176b87;background:#edfaff}.choice small{display:block;color:#596579}button{margin-top:18px;padding:12px 18px;border:0;border-radius:9px;background:#176b87;color:#fff;font-weight:700;cursor:pointer}</style><main><p>🐷 Piggybot</p><h1>${title}</h1>${content}</main></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}
