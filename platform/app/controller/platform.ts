import { Controller } from 'egg';
import { ADMIN_COOKIE, ADMIN_COOKIE_OPTIONS, adminPrincipal } from '../../src/admin/email-login';

import { HttpError } from '../../src/http/errors';
import { assertAuthSchema } from '../../src/foundation/auth-readiness';

export default class PlatformController extends Controller {
  async requestAdminLink(): Promise<void> {
    await this.app.platform.service.adminEmailLogin.requestLink(this.ctx.request.body, this.ctx.ip);
    this.ctx.status = 202;
    this.ctx.body = { message: 'If this email is authorized, a sign-in link will be sent.' };
  }
  async exchangeAdminLink(): Promise<void> {
    const session = await this.app.platform.service.adminEmailLogin.exchange(this.ctx.request.body);
    this.ctx.cookies.set(ADMIN_COOKIE, session, { ...ADMIN_COOKIE_OPTIONS, maxAge: 30 * 60 * 1000 });
    this.ctx.body = { ok: true };
  }
  async adminSession(): Promise<void> {
    const actor = this.ctx.state.platformAdminActor;
    if (!actor || !adminPrincipal(actor)) throw new HttpError(401, 'admin_session_required');
    this.ctx.body = { email: adminPrincipal(actor)!.email };
  }
  async logoutAdmin(): Promise<void> {
    await this.app.platform.service.adminEmailLogin.logout(this.ctx.cookies.get(ADMIN_COOKIE, { signed: false }) ?? '');
    this.ctx.cookies.set(ADMIN_COOKIE, '', { ...ADMIN_COOKIE_OPTIONS, maxAge: 0 });
    this.ctx.body = { ok: true };
  }
  async health(): Promise<void> { this.ctx.body = { ok: true, service: 'gateway' }; }

  async ready(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    try { await assertAuthSchema(this.app.platform.database); } catch (error) {
      this.ctx.logger.error(error);
      throw new HttpError(503, 'auth_database_not_ready');
    }
    this.ctx.body = { ok: true, service: 'gateway', authSchema: 'ready' };
  }

  async runtimeEvent(): Promise<void> {
    const rawBody = (this.ctx.state as { rawBody?: Buffer }).rawBody;
    if (!rawBody) throw new HttpError(401, 'unauthorized');
    this.app.platform.service.verifyAiRuntimeSignature(rawBody, this.ctx.get('x-ai-runtime-signature'));
    await this.app.platform.service.ingestAiRuntimeEvent(this.ctx.request.body);
    this.ctx.status = 202;
    this.ctx.body = { accepted: true };
  }

  async exchangeActivationTicket(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.exchangeActivationTicket(this.ctx.request.body);
  }

  async registerWithEmail(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.status = 201;
    this.ctx.body = await this.app.platform.service.registerWithEmail(this.ctx.request.body, this.ctx.ip);
  }

  async loginWithEmail(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.loginWithEmail(this.ctx.request.body, this.ctx.ip);
  }

  async me(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.me(this.actor());
  }

  async setPassword(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.setPassword(this.actor(), this.ctx.request.body);
  }

  async createImport(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.status = 201;
    this.ctx.body = await this.app.platform.service.createImport(this.actor(), this.ctx.request.body);
  }

  async listImports(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.listImports(this.actor());
  }

  async importDetail(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.importDetail(this.actor(), this.ctx.params.batchId);
  }

  async connectGoogleSheets(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.startGoogleSheetsConnection(this.actor());
  }

  async googleSheetsCallback(): Promise<void> {
    await this.app.platform.service.completeGoogleSheetsOAuth(this.ctx.query as Record<string, unknown>);
    this.ctx.type = 'html';
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.set('Referrer-Policy', 'no-referrer');
    this.ctx.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-KRFtUlQMceLgz+1bgqYT0dz3I/s+OlXv4GAu+TNrR0w='; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    this.ctx.body = googleSheetsPage();
  }

  async googleSheetsConnection(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.googleSheetsConnection(this.actor());
  }

  async disconnectGoogleSheets(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.disconnectGoogleSheets(this.actor());
  }

  async createInsight(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.status = 201;
    this.ctx.body = await this.app.platform.service.createInsight(this.actor(), this.ctx.request.body);
  }

  async listInsights(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.listInsights(this.actor());
  }

  async insightActions(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.insightActions(this.actor(), this.ctx.params.reportId);
  }

  async weeklyInsightReview(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.weeklyInsightReview(this.actor());
  }

  async weeklyHistory(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.weeklyHistory(this.actor());
  }

  async weeklyHistorySnapshot(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.weeklyHistorySnapshot(this.actor(), this.ctx.params.weekStart);
  }

  async sealWeeklyHistory(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.status = 201;
    this.ctx.body = await this.app.platform.service.sealWeeklyHistory(this.actor(), this.ctx.request.body);
  }

  async listNotificationRules(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.listNotificationRules(this.actor());
  }

  async putNotificationRule(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.putNotificationRule(this.actor(), this.ctx.params.kind, this.ctx.request.body);
  }

  async deleteNotificationRule(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.deleteNotificationRule(this.actor(), this.ctx.params.kind);
  }

  async listNotificationEvents(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.listNotificationEvents(this.actor(), this.ctx.query);
  }

  async approveNotificationEvent(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.approveNotificationEvent(this.actor(), this.ctx.params.eventId);
  }

  async actOnNotificationEvent(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.actOnNotificationEvent(this.actor(), this.ctx.params.eventId, this.ctx.request.body);
  }

  async saveInsightAction(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.saveInsightAction(this.actor(), this.ctx.params.reportId, this.ctx.params.actionKey, this.ctx.request.body);
  }

  async requestInsightDelivery(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.status = 201;
    this.ctx.body = await this.app.platform.service.requestInsightDelivery(this.actor(), this.ctx.params.reportId, this.ctx.request.body);
  }

  async insightDetail(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.insightDetail(this.actor(), this.ctx.params.reportId);
  }

  async createTopicRun(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.status = 201;
    this.ctx.body = await this.app.platform.service.startTopicRun(this.actor(), this.ctx.request.body);
  }

  async listTopics(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.listTopics(this.actor());
  }

  async topicItems(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.topicItems(this.actor(), this.ctx.params.topicId, this.ctx.query);
  }

  async createRun(): Promise<void> {
    const created = await this.app.platform.service.createWorkflowRun(this.actor(), this.ctx.request.body);
    this.ctx.status = 202;
    this.ctx.body = created;
  }

  async createStripeCheckout(): Promise<void> {
    const body = this.ctx.request.body;
    const cookie = this.ctx.cookies.get('piggy_ref', { signed: false });
    this.ctx.body = await this.app.platform.service.createStripeCheckout(this.actor(), {
      ...body, referralCode: body?.referralCode ?? (/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/.test(cookie ?? '') ? cookie : undefined),
    });
  }

  async reconcileStripeCheckout(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.reconcileStripeCheckout(this.actor(), this.ctx.request.body);
  }

  async recoverStripeCheckout(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.recoverStripeCheckout(this.actor());
  }
  async recoverStripeSubscription(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.recoverStripeSubscription(this.actor(), this.ctx.request.body);
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

  async pipelineTemplates(): Promise<void> { this.ctx.body = this.app.platform.service.pipelineTemplates(this.actor()); }
  async pipelines(): Promise<void> { this.ctx.body = await this.app.platform.service.pipelines(this.actor()); }
  async createPipeline(): Promise<void> {
    this.ctx.status = 201;
    this.ctx.body = await this.app.platform.service.createPipeline(this.actor(), this.ctx.request.body);
  }
  async updatePipeline(): Promise<void> { this.ctx.body = await this.app.platform.service.updatePipeline(this.actor(), this.ctx.params.pipelineId, this.ctx.request.body); }
  async testPipeline(): Promise<void> { this.ctx.body = await this.app.platform.service.testPipeline(this.actor(), this.ctx.params.pipelineId); }
  async activatePipeline(): Promise<void> { this.ctx.body = await this.app.platform.service.activatePipeline(this.actor(), this.ctx.params.pipelineId); }
  async connectedAccounts(): Promise<void> { this.ctx.body = await this.app.platform.service.connectedAccounts(this.actor()); }

  async connectZernio(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.startZernioConnection(this.actor(), this.ctx.query.platform);
  }

  async zernioCallback(): Promise<void> {
    let result;
    try {
      result = await this.app.platform.service.completeZernioOAuth(this.ctx.query as Record<string, unknown>);
    } catch (error) {
      if (!(error instanceof HttpError) || error.code !== 'google_business_no_locations') throw error;
      this.ctx.status = 409;
      this.ctx.type = 'html';
      this.ctx.set('Cache-Control', 'no-store');
      this.ctx.set('Referrer-Policy', 'no-referrer');
      this.ctx.set('Content-Security-Policy', "default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      this.ctx.body = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Google Business location required</title><h1>No Google Business locations found</h1><p>${escapeHtml(error.message)}</p><p><a href="https://business.google.com/" rel="noreferrer">Check Google Business Profile</a></p><p>Then return to Piggybot Accounts and reconnect. No account was connected by this attempt.</p></html>`;
      return;
    }
    this.ctx.type = 'html';
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.set('Referrer-Policy', 'no-referrer');
    this.ctx.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-s6ZpQMzFYFq3nShNxsGs170woi5zeqQZ2p0fBavjIl8='; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
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
  async billingOverview(): Promise<void> { this.ctx.body = await this.app.platform.service.customerBilling.overview(this.actor()); }
  async billingPortal(): Promise<void> { this.ctx.body = await this.app.platform.service.customerBilling.portal(this.actor(), this.ctx.request.body); }
  async creditTopup(): Promise<void> { this.ctx.body = await this.app.platform.service.customerBilling.startTopup(this.actor()); }
  async confirmCreditTopup(): Promise<void> { this.ctx.body = await this.app.platform.service.customerBilling.confirmTopup(this.actor(), this.ctx.request.body); }
  async referralLink(): Promise<void> { this.ctx.body = await this.app.platform.service.referralLink(this.actor()); }
  async referralContext(): Promise<void> {
    this.actor();
    this.ctx.set('Cache-Control', 'no-store');
    const code = this.ctx.cookies.get('piggy_ref', { signed: false });
    this.ctx.body = { referralCode: /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/.test(code ?? '') ? code : undefined };
  }
  async referralSummary(): Promise<void> { this.ctx.body = await this.app.platform.service.referralSummary(this.actor(), this.ctx.query); }
  async updateBillingEntitlements(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.updateBillingEntitlements(
      this.actor(),
      this.ctx.get('x-billing-admin-token'),
      this.ctx.request.body,
    );
  }
  async adminWorkspaces(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.adminWorkspaces(this.actor(), this.adminToken(), this.ctx.query);
  }
  async adminUpdateEntitlements(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.adminUpdateEntitlements(
      this.actor(), this.adminToken(), this.ctx.params.workspaceId, this.ctx.request.body,
    );
  }
  async adminFeedback(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.adminFeedback(this.actor(), this.adminToken(), this.ctx.query);
  }
  async adminNewsletter(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.adminNewsletter(this.actor(), this.adminToken(), this.ctx.query);
  }
  async adminUpdateFeedback(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.adminUpdateFeedback(
      this.actor(), this.adminToken(), this.ctx.params.ticketNo, this.ctx.request.body,
    );
  }
  async adminJobs(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.adminDeadLetterJobs(this.actor(), this.adminToken(), this.ctx.query);
  }
  async adminReplayJob(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.adminReplayJob(
      this.actor(), this.adminToken(), this.ctx.params.jobId, this.ctx.request.body,
    );
  }
  async adminReferrals(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.adminReferrals(this.actor(), this.adminToken(), this.ctx.query);
  }
  async adminVoidReferral(): Promise<void> {
    this.ctx.set('Cache-Control', 'no-store');
    this.ctx.body = await this.app.platform.service.adminVoidReferral(
      this.actor(), this.adminToken(), this.ctx.params.ledgerId, this.ctx.request.body,
    );
  }
  async auditEvents(): Promise<void> { this.ctx.body = await this.app.platform.service.auditEvents(this.actor()); }
  async feedback(): Promise<void> {
    this.ctx.status = 201;
    this.ctx.body = await this.app.platform.service.createFeedback(this.actor(), this.ctx.request.body);
  }

  private actor() {
    if (this.ctx.path.startsWith('/api/admin/') && this.ctx.state.platformAdminActor) return this.ctx.state.platformAdminActor;
    return this.app.platform.service.actorFrom(this.ctx.get('authorization'));
  }
  private adminToken() { return this.ctx.get('x-billing-admin-token'); }
}

function successPage(): string {
  return page('Account connected', '<p>Your social account is ready in Piggybot.</p><button type="button" onclick="window.close()">Close this window</button>', 'piggybot:zernio-connected');
}

function googleSheetsPage(): string {
  return page('Google Sheets connected', '<p>Your Google account is linked. Back in Piggybot, paste a spreadsheet ID to import its rows.</p><button type="button" onclick="window.close()">Close this window</button>', 'piggybot:google-sheets-connected');
}

function selectionPage(platform: string, choices: Array<{ label: string; detail?: string; token: string }>): string {
  const options = choices.map((choice, index) => `<label class="choice"><input type="radio" name="selection" value="${choice.token}" ${index === 0 ? 'checked' : ''} required><span><strong>${escapeHtml(choice.label)}</strong>${choice.detail ? `<small>${escapeHtml(choice.detail)}</small>` : ''}</span></label>`).join('');
  return page(`Choose your ${escapeHtml(platform)} account`, `<p>Choose the account Piggybot should use. This selection stays inside Piggybot.</p><form method="post" action="/api/zernio/select">${options}<button type="submit">Connect selected account</button></form>`);
}

function page(title: string, content: string, notifyMessage?: string): string {
  const script = notifyMessage ? `<script>window.opener?.postMessage({type:"${notifyMessage}"}, "*");</script>` : '';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title} · Piggybot</title><style>body{box-sizing:border-box;margin:0;min-height:100vh;padding:32px;background:#fffaf0;color:#172033;font:16px/1.5 system-ui,sans-serif}main{max-width:560px;margin:5vh auto;padding:28px;border:2px solid #172033;border-radius:18px;background:#fff}h1{margin-top:0;font-size:28px}.choice{display:flex;gap:12px;align-items:flex-start;margin:12px 0;padding:14px;border:1px solid #b8c2d0;border-radius:12px;cursor:pointer}.choice:has(input:checked){border-color:#176b87;background:#edfaff}.choice small{display:block;color:#596579}button{margin-top:18px;padding:12px 18px;border:0;border-radius:9px;background:#176b87;color:#fff;font-weight:700;cursor:pointer}</style>${script}<main><p>🐷 Piggybot</p><h1>${title}</h1>${content}</main></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}
