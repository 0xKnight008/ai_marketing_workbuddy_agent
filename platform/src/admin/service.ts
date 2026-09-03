import { timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { resumeBillingPausedRuns, updateEntitlement, usageSnapshot, type UsageSnapshot } from '../billing/guardrails';
import { PLAN_KEYS } from '../billing/plans';
import type { ActorContext } from '../contracts/domain';
import { Database, type TenantTransaction } from '../foundation/database';
import type { GatewayConfig } from '../foundation/platform-config';
import { HttpError } from '../http/errors';

const feedbackStatusSchema = z.enum(['new', 'replied', 'closed']);
const referralStatusSchema = z.enum(['pending', 'available', 'void', 'clawed_back']);
const searchSchema = z.object({ q: z.string().trim().max(200).default('') });

interface WorkspaceDirectoryRow {
  id: string;
  name: string;
  slug: string;
  ownerEmail: string | null;
  createdAt: string;
}

export interface AdminWorkspaceView extends WorkspaceDirectoryRow {
  usage: UsageSnapshot;
}

interface FeedbackRow {
  id: string;
  ticketNo: string;
  workspaceId: string | null;
  workspaceName: string | null;
  email: string;
  name: string | null;
  category: string;
  message: string;
  status: string;
  discordThreadId: string | null;
  repliedBy: string | null;
  createdAt: string;
  repliedAt: string | null;
}

interface AdminJobRow {
  id: string;
  workspaceId: string;
  workspaceName: string;
  runId: string | null;
  kind: string;
  attempt: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AdminReferralRow {
  attributionId: string;
  workspaceId: string;
  workspaceName: string;
  referralCode: string;
  referredWorkspaceId: string;
  referredWorkspaceName: string;
  source: string | null;
  attributedAt: string;
  ledgerId: string | null;
  stripeInvoiceId: string | null;
  amountMicros: string | null;
  currency: string | null;
  status: string | null;
  availableAt: string | null;
  stripeBalanceTxn: string | null;
  createdAt: string | null;
}

export class AdminService {
  constructor(private readonly config: GatewayConfig, private readonly database: Database) {}

  async workspaces(actor: ActorContext, adminToken: string | undefined, query: unknown): Promise<AdminWorkspaceView[]> {
    this.authorize(actor, adminToken);
    const { q } = searchSchema.parse(query ?? {});
    const directory = await this.workspaceDirectory(q);
    return Promise.all(directory.map(async (workspace) => ({
      ...workspace,
      usage: await this.database.withWorkspace(workspace.id, usageSnapshot),
    })));
  }

  async updateEntitlements(
    actor: ActorContext,
    adminToken: string | undefined,
    workspaceId: unknown,
    body: unknown,
  ): Promise<unknown> {
    this.authorize(actor, adminToken);
    const targetWorkspaceId = z.string().uuid().parse(workspaceId);
    const parsed = z.object({
      plan: z.enum(PLAN_KEYS).optional(),
      additionalAiCredits: z.number().int().nonnegative()
        .refine((value) => value % 1_000 === 0, 'additionalAiCredits must be a multiple of 1000')
        .default(0),
    }).parse(body ?? {});
    if (!parsed.plan && parsed.additionalAiCredits === 0) throw new HttpError(400, 'entitlement_change_required');
    return this.database.withWorkspace(targetWorkspaceId, async (tx) => {
      const current = await usageSnapshot(tx);
      const usage = await updateEntitlement(tx, parsed.plan ?? current.plan, parsed.additionalAiCredits);
      const resumedRuns = usage.status === 'paused' ? 0 : await resumeBillingPausedRuns(tx);
      await this.audit(tx, targetWorkspaceId, actor, 'admin.billing_entitlement_updated', {
        operatorWorkspaceId: actor.workspaceId,
        plan: usage.plan,
        additionalAiCredits: parsed.additionalAiCredits,
        resumedRuns,
      });
      return { usage, resumedRuns };
    });
  }

  async feedback(actor: ActorContext, adminToken: string | undefined, query: unknown): Promise<FeedbackRow[]> {
    this.authorize(actor, adminToken);
    const parsed = z.object({
      q: z.string().trim().max(200).default(''),
      status: feedbackStatusSchema.optional(),
    }).parse(query ?? {});
    return this.database.withAdmin(async (tx) => {
      const result = await tx.query<FeedbackRow>(`
        SELECT f.id, f.ticket_no AS "ticketNo", f.workspace_id AS "workspaceId",
               w.name AS "workspaceName", f.email::text, f.name, f.category, f.message,
               f.status, f.discord_thread_id AS "discordThreadId", f.replied_by AS "repliedBy",
               f.created_at::text AS "createdAt", f.replied_at::text AS "repliedAt"
          FROM feedback_message f
          LEFT JOIN workspace w ON w.id = f.workspace_id
         WHERE ($1::text IS NULL OR f.status = $1)
           AND ($2 = '' OR f.ticket_no ILIKE '%' || $2 || '%' OR f.email::text ILIKE '%' || $2 || '%'
                OR COALESCE(f.name, '') ILIKE '%' || $2 || '%' OR COALESCE(w.name, '') ILIKE '%' || $2 || '%')
         ORDER BY f.created_at DESC
         LIMIT 100`, [parsed.status ?? null, parsed.q]);
      return result.rows;
    });
  }

  async updateFeedback(
    actor: ActorContext,
    adminToken: string | undefined,
    ticketNo: unknown,
    body: unknown,
  ): Promise<FeedbackRow> {
    this.authorize(actor, adminToken);
    const ticket = z.string().regex(/^FB-[0-9A-F]{8}$/).parse(ticketNo);
    const { status } = z.object({ status: feedbackStatusSchema }).parse(body ?? {});
    const location = await this.database.withAdmin(async (tx) => {
      const result = await tx.query<{ workspaceId: string | null }>(
        'SELECT workspace_id AS "workspaceId" FROM feedback_message WHERE ticket_no = $1',
        [ticket],
      );
      const row = result.rows[0];
      if (!row) throw new HttpError(404, 'feedback_not_found');
      return row;
    });
    const auditWorkspaceId = location.workspaceId ?? actor.workspaceId;
    return this.database.withWorkspace(auditWorkspaceId, async (tx) => {
      const result = await tx.query<FeedbackRow>(`
        UPDATE feedback_message
           SET status = $2,
               replied_by = CASE WHEN $2 = 'replied' THEN $3 ELSE replied_by END,
               replied_at = CASE WHEN $2 = 'replied' THEN COALESCE(replied_at, now()) ELSE replied_at END
         WHERE ticket_no = $1
         RETURNING id, ticket_no AS "ticketNo", workspace_id AS "workspaceId", NULL::text AS "workspaceName",
                   email::text, name, category, message, status, discord_thread_id AS "discordThreadId",
                   replied_by AS "repliedBy", created_at::text AS "createdAt", replied_at::text AS "repliedAt"`,
      [ticket, status, actor.actorId]);
      const row = result.rows[0];
      if (!row) throw new HttpError(404, 'feedback_not_found');
      await this.audit(tx, auditWorkspaceId, actor, 'admin.feedback_status_changed', {
        ticketNo: ticket,
        status,
        ticketWorkspaceId: location.workspaceId,
        operatorWorkspaceId: actor.workspaceId,
      });
      return row;
    });
  }

  async deadLetterJobs(actor: ActorContext, adminToken: string | undefined, query: unknown): Promise<AdminJobRow[]> {
    this.authorize(actor, adminToken);
    const { q } = searchSchema.parse(query ?? {});
    const directory = await this.workspaceDirectory(q);
    const jobs = await Promise.all(directory.map(async (workspace) => this.database.withWorkspace(workspace.id, async (tx) => {
      const result = await tx.query<Omit<AdminJobRow, 'workspaceName'>>(`
        SELECT id, workspace_id AS "workspaceId", run_id AS "runId", kind, attempt,
               max_attempts AS "maxAttempts", last_error AS "lastError",
               created_at::text AS "createdAt", updated_at::text AS "updatedAt"
          FROM job
         WHERE workspace_id = current_setting('app.workspace_id')::uuid AND status = 'dead_lettered'
         ORDER BY updated_at DESC
         LIMIT 100`);
      return result.rows.map((job) => ({ ...job, workspaceName: workspace.name }));
    })));
    return jobs.flat().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 100);
  }

  async replayJob(
    actor: ActorContext,
    adminToken: string | undefined,
    jobId: unknown,
    body: unknown,
  ): Promise<{ id: string; status: 'queued' }> {
    this.authorize(actor, adminToken);
    const id = z.string().uuid().parse(jobId);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(body ?? {});
    return this.database.withWorkspace(workspaceId, async (tx) => {
      const result = await tx.query<{ id: string; runId: string | null }>(`
        UPDATE job
           SET status = 'queued', attempt = 0, available_at = now(), locked_at = NULL,
               locked_by = NULL, last_error = NULL, updated_at = now()
         WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid
           AND status = 'dead_lettered'
         RETURNING id, run_id AS "runId"`, [id]);
      const replayed = result.rows[0];
      if (!replayed) throw new HttpError(409, 'job_not_dead_lettered');
      if (replayed.runId) {
        await tx.query("UPDATE workflow_run SET status = 'queued', finished_at = NULL WHERE id = $1 AND workspace_id = $2 AND status = 'dead_lettered'", [replayed.runId, workspaceId]);
        await tx.query(`INSERT INTO run_event (workspace_id, run_id, event_key, event_type, payload)
          VALUES ($1, $2, $3, 'run.admin_replayed', $4) ON CONFLICT (run_id, event_key) DO NOTHING`, [
          workspaceId,
          replayed.runId,
          `admin-replay:${id}:${Date.now()}`,
          { jobId: id, operatorWorkspaceId: actor.workspaceId },
        ]);
      }
      await this.audit(tx, workspaceId, actor, 'admin.job_replayed', { jobId: id, runId: replayed.runId, operatorWorkspaceId: actor.workspaceId });
      return { id, status: 'queued' as const };
    });
  }

  async referrals(actor: ActorContext, adminToken: string | undefined, query: unknown): Promise<AdminReferralRow[]> {
    this.authorize(actor, adminToken);
    const parsed = z.object({
      q: z.string().trim().max(200).default(''),
      status: referralStatusSchema.optional(),
    }).parse(query ?? {});
    const directory = await this.workspaceDirectory(parsed.q);
    const workspaceNames = new Map(directory.map((workspace) => [workspace.id, workspace.name]));
    const entries = await Promise.all(directory.map(async (workspace) => this.database.withWorkspace(workspace.id, async (tx) => {
      const result = await tx.query<Omit<AdminReferralRow, 'workspaceName' | 'referredWorkspaceName'>>(`
        SELECT a.id AS "attributionId", a.referrer_workspace_id AS "workspaceId", a.referral_code AS "referralCode",
               a.referred_workspace_id AS "referredWorkspaceId", a.source, a.attributed_at::text AS "attributedAt",
               l.id AS "ledgerId", l.stripe_invoice_id AS "stripeInvoiceId", l.amount_micros::text AS "amountMicros",
               l.currency, l.status, l.available_at::text AS "availableAt", l.stripe_balance_txn AS "stripeBalanceTxn",
               l.created_at::text AS "createdAt"
          FROM referral_attribution a
          LEFT JOIN referral_credit_ledger l ON l.attribution_id = a.id
         WHERE a.referrer_workspace_id = current_setting('app.workspace_id')::uuid
           AND ($1::text IS NULL OR l.status = $1)
         ORDER BY a.attributed_at DESC
         LIMIT 100`, [parsed.status ?? null]);
      return result.rows.map((entry) => ({
        ...entry,
        workspaceName: workspace.name,
        referredWorkspaceName: workspaceNames.get(entry.referredWorkspaceId) ?? entry.referredWorkspaceId,
      }));
    })));
    return entries.flat().sort((left, right) => right.attributedAt.localeCompare(left.attributedAt)).slice(0, 100);
  }

  async voidReferral(
    actor: ActorContext,
    adminToken: string | undefined,
    ledgerId: unknown,
    body: unknown,
  ): Promise<{ id: string; status: string }> {
    this.authorize(actor, adminToken);
    const id = z.string().uuid().parse(ledgerId);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(body ?? {});
    return this.database.withWorkspace(workspaceId, async (tx) => {
      const locked = await tx.query<{ stripeInvoiceId: string; status: string }>(`
        SELECT stripe_invoice_id AS "stripeInvoiceId", status
          FROM referral_credit_ledger
         WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid
         FOR UPDATE`, [id]);
      const ledger = locked.rows[0];
      if (!ledger) throw new HttpError(404, 'referral_credit_not_found');
      let status: string;
      if (ledger.status === 'pending') {
        const running = await tx.query<{ id: string }>(`
          SELECT id FROM job
           WHERE workspace_id = current_setting('app.workspace_id')::uuid
             AND kind = 'issue_referral_credit' AND payload->>'invoiceId' = $1 AND status = 'running'
           FOR UPDATE`, [ledger.stripeInvoiceId]);
        if (running.rows[0]) throw new HttpError(409, 'referral_credit_in_progress');
        await tx.query("UPDATE referral_credit_ledger SET status = 'void' WHERE id = $1", [id]);
        await tx.query(`UPDATE job
          SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = now()
          WHERE workspace_id = current_setting('app.workspace_id')::uuid
            AND kind = 'issue_referral_credit' AND payload->>'invoiceId' = $1
            AND status IN ('queued', 'dead_lettered')`, [ledger.stripeInvoiceId]);
        status = 'void';
      } else if (ledger.status === 'available') {
        await tx.query('SELECT queue_referral_clawback($1)', [ledger.stripeInvoiceId]);
        status = 'clawed_back';
      } else {
        throw new HttpError(409, 'referral_credit_not_reversible');
      }
      await this.audit(tx, workspaceId, actor, 'admin.referral_credit_reversed', {
        ledgerId: id,
        stripeInvoiceId: ledger.stripeInvoiceId,
        previousStatus: ledger.status,
        status,
        operatorWorkspaceId: actor.workspaceId,
      });
      return { id, status };
    });
  }

  private authorize(actor: ActorContext, adminToken: string | undefined): void {
    if (actor.role !== 'owner' && actor.role !== 'admin') throw new HttpError(403, 'platform_admin_required');
    const configured = this.config.BILLING_ADMIN_TOKEN;
    if (!configured || !adminToken || !safeEqual(configured, adminToken)) throw new HttpError(403, 'platform_admin_required');
  }

  private async workspaceDirectory(q: string): Promise<WorkspaceDirectoryRow[]> {
    return this.database.withAdmin(async (tx) => {
      const result = await tx.query<WorkspaceDirectoryRow>(`
        SELECT w.id, w.name, w.slug, MIN(u.email::text) FILTER (WHERE m.role = 'owner') AS "ownerEmail",
               w.created_at::text AS "createdAt"
          FROM workspace w
          LEFT JOIN workspace_membership m ON m.workspace_id = w.id
          LEFT JOIN app_user u ON u.id = m.user_id
         WHERE ($1 = '' OR w.name ILIKE '%' || $1 || '%' OR w.slug ILIKE '%' || $1 || '%'
                OR u.email::text ILIKE '%' || $1 || '%')
         GROUP BY w.id, w.name, w.slug, w.created_at
         ORDER BY w.created_at DESC
         LIMIT 100`, [q]);
      return result.rows;
    });
  }

  private async audit(
    tx: TenantTransaction,
    workspaceId: string,
    actor: ActorContext,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await tx.query('INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)', [
      workspaceId,
      actor.actorId,
      eventType,
      payload,
    ]);
  }
}

function safeEqual(expected: string, received: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}
