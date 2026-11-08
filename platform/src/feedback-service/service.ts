import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { ActorContext } from "../contracts/domain";
import type { Database, TenantTransaction } from "../foundation/database";
import { requirePermission } from "../foundation/rbac";
import { requireAutomationAccess, usageSnapshot } from "../billing/guardrails";
import { HttpError } from "../http/errors";
import { readRecentPosts, supportsRecentPosts } from './posts';
import {
  collectFeedback,
  supportedReadPlatform,
  type InboxReader,
  type FeedbackAccount,
  type Checkpoint,
} from "./reader";
import {
  COST_VERSION,
  meteringMode,
  ratesFromEnv,
  rateForTime,
} from "../../../shared/ai-metering";
const ids = z
  .array(z.string().uuid())
  .min(1)
  .max(10)
  .refine((a) => new Set(a).size === a.length);
const band = z.enum(["eco", "standard", "flagship"]);
const scanInput = z
  .object({
    requestId: z.string().uuid(),
    accountIds: ids,
    range: z.enum(["24h", "7d", "since"]).default("24h"),
    maxItems: z.number().int().min(1).max(2000).default(500),
  })
  .strict();
const scheduleInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    goal: z.string().trim().min(1).max(4000),
    accountIds: ids,
    modelBand: band,
    language: z.enum(["en", "es", "zh"]),
    localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: z
      .string()
      .max(80)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }),
    dailyCredits: z.number().int().min(1).max(10000),
    maxItems: z.number().int().min(1).max(2000),
    enabled: z.boolean(),
    consent: z.literal(true),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();
export type ScheduleInput = z.infer<typeof scheduleInput>;
const accountSql = `SELECT a.id,a.external_account_id AS "externalId",a.zernio_profile_id AS "profileId",a.platform,a.display_name AS "displayName",a.status FROM connected_account a JOIN zernio_tenant z ON z.workspace_id=a.workspace_id AND z.profile_id=a.zernio_profile_id WHERE a.workspace_id=$1 AND a.provider='zernio'`;
const scanColumns = `s.id,s.status,s.batch_id AS "batchId",s.item_count AS "itemCount",s.coverage,s.created_at AS "createdAt",s.report_id AS "reportId",s.analysis_error AS "analysisError",s.schedule_id AS "scheduleId",r.status AS "reportStatus",r.error AS "reportError"`;
const scheduleColumns = `id,name,goal,account_ids AS "accountIds",model_band AS "modelBand",language,local_time::text AS "localTime",timezone,daily_credits AS "dailyCredits",max_items AS "maxItems",enabled,next_run_at AS "nextRunAt",version,last_error AS "lastError"`;
export function nextDailyTime(
  time: string,
  zone: string,
  after = new Date(),
): Date {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  let d = new Date(Math.floor(after.getTime() / 60000) * 60000 + 60000);
  for (let i = 0; i < 3000; i++, d = new Date(d.getTime() + 60000)) {
    if (f.format(d) === time.slice(0, 5)) return d;
  }
  throw new Error("schedule_time_invalid");
}
async function allowedAccounts(
  tx: TenantTransaction,
  workspaceId: string,
  accountIds: string[],
  postsOnly = false,
) {
  const r = await tx.query<FeedbackAccount>(
    accountSql + " AND a.id=ANY($2::uuid[])",
    [workspaceId, accountIds],
  );
  if (
    r.rows.length !== accountIds.length ||
    r.rows.some(
      (a) => a.status !== "connected" || !(postsOnly ? supportsRecentPosts(a.platform) : supportedReadPlatform(a.platform)),
    )
  )
    throw new HttpError(422, "feedback_accounts_unavailable");
  return r.rows;
}
export class FeedbackService {
  constructor(
    private readonly database: Pick<Database, "withWorkspace">,
    private readonly reader?: InboxReader,
  ) {}
  async accounts(actor: ActorContext) {
    requirePermission(actor.role, "workflow:run");
    return this.database.withWorkspace(actor.workspaceId, async (tx) =>
      (
        await tx.query<FeedbackAccount>(accountSql, [actor.workspaceId])
      ).rows.filter(a => a.status !== 'disconnected').map((a) => ({
        id: a.id,
        displayName: a.displayName,
        platform: a.platform,
        status: a.status,
        postsSupported: !!this.reader && supportsRecentPosts(a.platform) && a.status === 'connected',
        supported:
          !!this.reader &&
          supportedReadPlatform(a.platform) &&
          a.status === "connected",
        scope: "public_comments_recent_posts",
        postWindowDays: a.platform === 'twitter' ? 30 : null,
        recentPostsLimit: 25,
      })),
    );
  }
  async recentPosts(actor: ActorContext, accountId: string) {
    requirePermission(actor.role, 'workflow:run');
    z.string().uuid().parse(accountId);
    if (!this.reader) throw new HttpError(503, 'feedback_provider_not_configured');
    const account = await this.database.withWorkspace(actor.workspaceId, async tx => {
      await requireAutomationAccess(tx);
      return (await allowedAccounts(tx, actor.workspaceId, [accountId], true))[0]!;
    });
    try {return {posts: await readRecentPosts(this.reader, actor.workspaceId, account), limit:25};}
    catch (error) {const message=error instanceof Error?error.message:'';throw new HttpError(422,/^feedback_[a-z_]+$/.test(message)?message:'feedback_source_unavailable');}
  }
  async createScan(actor: ActorContext, body: unknown) {
    requirePermission(actor.role, "workflow:run");
    const input = scanInput.parse(body);
    if (input.maxItems < input.accountIds.length)
      throw new HttpError(422, "feedback_item_limit_too_small");
    if (!this.reader)
      throw new HttpError(503, "feedback_provider_not_configured");
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      await requireAutomationAccess(tx);
      await allowedAccounts(tx, actor.workspaceId, input.accountIds);
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `scan:${actor.workspaceId}`,
      ]);
      const old = await tx.query<{
        id: string;
        accounts: string[];
        range: string;
        max: number;
      }>(
        "SELECT id,account_ids AS accounts,requested_range AS range,max_items AS max FROM feedback_scan WHERE workspace_id=$1 AND request_id=$2",
        [actor.workspaceId, input.requestId],
      );
      if (old.rows[0]) {
        const row = old.rows[0];
        if (
          JSON.stringify([...row.accounts].sort()) !==
            JSON.stringify([...input.accountIds].sort()) ||
          row.range !== input.range ||
          row.max !== input.maxItems
        )
          throw new HttpError(409, "feedback_request_conflict");
        return { id: row.id };
      }
      const active = await tx.query(
        "SELECT 1 FROM feedback_scan WHERE workspace_id=$1 AND schedule_id IS NULL AND status IN ('queued','running') AND account_ids && $2::uuid[] LIMIT 1",
        [actor.workspaceId, input.accountIds],
      );
      if (active.rowCount)
        throw new HttpError(409, "feedback_collection_in_progress");
      const r = await tx.query<{ id: string }>(
        `INSERT INTO feedback_scan(workspace_id,request_id,created_by,account_ids,since_at,max_items,requested_range) VALUES($1,$2,$3,$4,now()-$5::interval,$6,$7) RETURNING id`,
        [
          actor.workspaceId,
          input.requestId,
          actor.actorId,
          input.accountIds,
          input.range === "7d" ? "7 days" : "1 day",
          input.maxItems,
          input.range,
        ],
      );
      const id = r.rows[0]!.id;
      await tx.query(
        "INSERT INTO job(workspace_id,kind,payload) VALUES($1,'feedback.scan',$2)",
        [actor.workspaceId, { scanId: id }],
      );
      return { id };
    });
  }
  async scan(actor: ActorContext, id: string) {
    requirePermission(actor.role, "workflow:run");
    z.string().uuid().parse(id);
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      const r = await tx.query(
        `SELECT ${scanColumns} FROM feedback_scan s LEFT JOIN insight_report r ON r.id=s.report_id AND r.workspace_id=s.workspace_id WHERE s.workspace_id=$1 AND s.id=$2`,
        [actor.workspaceId, id],
      );
      if (!r.rows[0]) throw new HttpError(404, "feedback_scan_not_found");
      return r.rows[0];
    });
  }
  async acceptScan(actor: ActorContext, id: string, body: unknown) {
    requirePermission(actor.role, "workflow:run");
    z.string().uuid().parse(id);
    z.object({ confirmPartial: z.literal(true) })
      .strict()
      .parse(body);
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      const r = await tx.query<{ batch_id: string }>(
        "UPDATE feedback_scan SET analysis_accepted_at=COALESCE(analysis_accepted_at,now()),analysis_accepted_by=COALESCE(analysis_accepted_by,$3) WHERE workspace_id=$1 AND id=$2 AND status='partial' AND item_count>0 RETURNING batch_id",
        [actor.workspaceId, id, actor.actorId],
      );
      if (!r.rows[0]) throw new HttpError(409, "feedback_scan_not_acceptable");
      const restored = await tx.query(
        "UPDATE import_batch SET status='classified',classified_at=now() WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING id",
        [actor.workspaceId, r.rows[0].batch_id],
      );
      if(!restored.rowCount)throw new HttpError(410,"import_deleted");
      await tx.query(
        "INSERT INTO audit_event(workspace_id,actor_id,event_type,payload) VALUES($1,$2,'feedback.partial_accepted',$3)",
        [actor.workspaceId, actor.actorId, { scanId: id }],
      );
      return { batchId: r.rows[0].batch_id };
    });
  }
  async schedules(actor: ActorContext) {
    requirePermission(actor.role, "workflow:run");
    return this.database.withWorkspace(
      actor.workspaceId,
      async (tx) =>
        (
          await tx.query(
            `SELECT ${scheduleColumns} FROM feedback_schedule WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100`,
            [actor.workspaceId],
          )
        ).rows,
    );
  }
  async saveSchedule(
    actor: ActorContext,
    id: string | undefined,
    body: unknown,
  ) {
    requirePermission(actor.role, "workflow:run");
    const input = scheduleInput.parse(body);
    if (input.maxItems < input.accountIds.length)
      throw new HttpError(422, "feedback_item_limit_too_small");
    if (id) z.string().uuid().parse(id);
    if (meteringMode() !== "cost-v1")
      throw new HttpError(409, "feedback_schedule_requires_cost_metering");
    if (!this.reader)
      throw new HttpError(503, "feedback_provider_not_configured");
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      await requireAutomationAccess(tx);
      await allowedAccounts(tx, actor.workspaceId, input.accountIds);
      const next = nextDailyTime(input.localTime, input.timezone);
      const values = [
        actor.workspaceId,
        input.name,
        input.goal,
        input.accountIds,
        input.modelBand,
        input.language,
        input.localTime,
        input.timezone,
        input.dailyCredits,
        input.maxItems,
        input.enabled,
        next,
        actor.actorId,
      ];
      const r = id
        ? await tx.query<{ id: string }>(
            `UPDATE feedback_schedule SET name=$2,goal=$3,account_ids=$4,model_band=$5,language=$6,local_time=$7,timezone=$8,daily_credits=$9,max_items=$10,enabled=$11,next_run_at=$12,created_by=$13,authorized_at=now(),version=version+1,updated_at=now(),last_error=NULL WHERE workspace_id=$1 AND id=$14 AND version=$15 RETURNING id`,
            [...values, id, input.expectedVersion ?? 0],
          )
        : await tx.query<{ id: string }>(
            `INSERT INTO feedback_schedule(workspace_id,name,goal,account_ids,model_band,language,local_time,timezone,daily_credits,max_items,enabled,next_run_at,created_by,authorized_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now()) RETURNING id`,
            values,
          );
      if (!r.rows[0]) throw new HttpError(409, "schedule_version_conflict");
      await tx.query(
        "INSERT INTO audit_event(workspace_id,actor_id,event_type,payload) VALUES($1,$2,$3,$4)",
        [
          actor.workspaceId,
          actor.actorId,
          "feedback.schedule_authorized",
          { scheduleId: r.rows[0].id, ...input },
        ],
      );
      return r.rows[0];
    });
  }
  async pause(actor: ActorContext, id: string, body: unknown) {
    requirePermission(actor.role, "workflow:run");
    z.string().uuid().parse(id);
    const input = z
      .object({ expectedVersion: z.number().int().positive() })
      .parse(body);
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      const r = await tx.query(
        "UPDATE feedback_schedule SET enabled=false,version=version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND version=$3 RETURNING id",
        [actor.workspaceId, id, input.expectedVersion],
      );
      if (!r.rows[0]) throw new HttpError(409, "schedule_version_conflict");
      await tx.query(
        "INSERT INTO audit_event(workspace_id,actor_id,event_type,payload) VALUES($1,$2,$3,$4)",
        [
          actor.workspaceId,
          actor.actorId,
          "feedback.schedule_paused",
          { scheduleId: id },
        ],
      );
      return r.rows[0];
    });
  }
  async history(actor: ActorContext, id: string) {
    requirePermission(actor.role, "workflow:run");
    z.string().uuid().parse(id);
    return this.database.withWorkspace(
      actor.workspaceId,
      async (tx) =>
        (
          await tx.query(
            `SELECT ${scanColumns} FROM feedback_scan s LEFT JOIN insight_report r ON r.id=s.report_id AND r.workspace_id=s.workspace_id WHERE s.workspace_id=$1 AND s.schedule_id=$2 ORDER BY s.created_at DESC LIMIT 50`,
            [actor.workspaceId, id],
          )
        ).rows,
    );
  }
  async enqueueDue(workspaceId: string) {
    return this.database.withWorkspace(workspaceId, async (tx) => {
      const rows = await tx.query<any>(
        `SELECT *, (now() AT TIME ZONE timezone)::date::text AS day FROM feedback_schedule WHERE workspace_id=$1 AND enabled AND next_run_at<=now() ORDER BY next_run_at LIMIT 25 FOR UPDATE SKIP LOCKED`,
        [workspaceId],
      );
      for (const s of rows.rows) {
        const membership = await tx.query<{ role: string }>(
          "SELECT role FROM workspace_membership WHERE workspace_id=$1 AND user_id=$2",
          [workspaceId, s.created_by],
        );
        if (!membership.rows[0] || membership.rows[0].role === "viewer") {
          await tx.query(
            "UPDATE feedback_schedule SET enabled=false,last_error='schedule_authorization_revoked' WHERE workspace_id=$1 AND id=$2",
            [workspaceId, s.id],
          );
          continue;
        }
        const recent = await tx.query(
          `SELECT 1 FROM feedback_scan WHERE workspace_id=$1 AND schedule_id=$2 AND (status IN ('queued','running') OR created_at>now()-interval '24 hours') LIMIT 1`,
          [workspaceId, s.id],
        );
        if (recent.rowCount) {
          await tx.query(
            "UPDATE feedback_schedule SET next_run_at=now()+interval '1 minute' WHERE workspace_id=$1 AND id=$2",
            [workspaceId, s.id],
          );
          continue;
        }
        const r = await tx.query<{ id: string }>(
          `INSERT INTO feedback_scan(workspace_id,request_id,created_by,account_ids,since_at,max_items,requested_range,schedule_id,scheduled_date,schedule_snapshot) VALUES($1,$2,$3,$4,now()-interval '1 day',$5,'since',$6,$7,$8) ON CONFLICT(schedule_id,scheduled_date) DO NOTHING RETURNING id`,
          [
            workspaceId,
            randomUUID(),
            s.created_by,
            s.account_ids,
            s.max_items,
            s.id,
            s.day,
            JSON.stringify(s),
          ],
        );
        if (r.rows[0])
          await tx.query(
            "INSERT INTO job(workspace_id,kind,payload) VALUES($1,'feedback.scan',$2)",
            [workspaceId, { scanId: r.rows[0].id }],
          );
        await tx.query(
          "UPDATE feedback_schedule SET next_run_at=$3 WHERE workspace_id=$1 AND id=$2",
          [workspaceId, s.id, nextDailyTime(s.local_time, s.timezone)],
        );
      }
      return rows.rowCount;
    });
  }
  async executeScan(workspaceId: string, scanId: string) {
    if (!this.reader) throw new Error("feedback_provider_not_configured");
    const scan = await this.database.withWorkspace(workspaceId, async (tx) => {
      await requireAutomationAccess(tx);
      const r = await tx.query<any>(
        "SELECT * FROM feedback_scan WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
        [workspaceId, scanId],
      );
      const row = r.rows[0];
      if (!row) throw new Error("feedback_scan_not_found");
      if (["completed", "partial", "failed"].includes(row.status)) return null;
      const member = await tx.query<{ role: string }>(
        "SELECT role FROM workspace_membership WHERE workspace_id=$1 AND user_id=$2",
        [workspaceId, row.created_by],
      );
      if (!member.rows[0] || member.rows[0].role === "viewer")
        throw new HttpError(403, "feedback_authorization_revoked");
      if (!row.batch_id) {
        const b = await tx.query<{ id: string }>(
          `INSERT INTO import_batch(workspace_id,label,source_type,model_band,created_by) VALUES($1,$3,'channel_feedback','eco',$2) RETURNING id`,
          [workspaceId, row.created_by,`Channel feedback · ${new Date(row.created_at).toISOString()}`],
        );
        row.batch_id = b.rows[0]!.id;
      }
      await tx.query(
        "UPDATE feedback_scan SET status='running',batch_id=$3 WHERE workspace_id=$1 AND id=$2",
        [workspaceId, scanId, row.batch_id],
      );
      return row;
    });
    if (!scan) return;
    const scope = scan.schedule_id ?? "00000000-0000-0000-0000-000000000000";
    const coverage: Array<Record<string, unknown>> = Array.isArray(
      scan.coverage,
    )
      ? scan.coverage
      : [];
    for (const id of scan.account_ids as string[]) {
      if (coverage.some((c) => c.accountId === id)) continue;
      const input = await this.database
        .withWorkspace(workspaceId, async (tx) => {
          const accounts = await allowedAccounts(tx, workspaceId, [id]);
          const s = await tx.query<{
            last: string | null;
            checkpoint: Checkpoint | null;
          }>(
            "SELECT last_success_at::text AS last,checkpoint FROM feedback_source_state WHERE workspace_id=$1 AND account_id=$2 AND scope_id=$3",
            [workspaceId, id, scope],
          );
          return { account: accounts[0]!, state: s.rows[0] };
        })
        .catch(() => null);
      if (!input) {
        coverage.push({
          accountId: id,
          error: "feedback_accounts_unavailable",
          complete: false,
        });
        continue;
      }
      const since =
        scan.requested_range === "since" && input.state?.last
          ? new Date(Date.parse(input.state.last) - 15 * 60000).toISOString()
          : new Date(scan.since_at).toISOString();
      const result = await collectFeedback(
        this.reader,
        workspaceId,
        input.account,
        since,
        new Date(scan.until_at).toISOString(),
        Math.max(1, Math.floor(scan.max_items / scan.account_ids.length)),
        scan.requested_range === "since" ? input.state?.checkpoint : null,
      );
      await this.database.withWorkspace(workspaceId, async (tx) => {
        // Serialize deduplication and progress commits. Duplicate remote reads are harmless.
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `feedback:${workspaceId}:${id}`,
        ]);
        let inserted = 0,
          duplicates = 0;
        for (const item of result.items) {
          const hash = createHash("sha256").update(item.text).digest("hex");
          const old = await tx.query(
            "SELECT item_id FROM feedback_comment WHERE workspace_id=$1 AND account_id=$2 AND external_id=$3 AND content_hash=$4 AND scope_id=$5",
            [workspaceId, id, item.id, hash, scope],
          );
          if (old.rowCount) {
            duplicates++;
            continue;
          }
          const r = await tx.query<{ id: string }>(
            `INSERT INTO import_item(workspace_id,batch_id,platform,external_id,author,text,metrics,classified_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()) RETURNING id`,
            [
              workspaceId,
              scan.batch_id,
              input.account.platform,
              item.id,
              item.author,
              item.text,
              {
                publishedAt: item.publishedAt,
                url: item.url,
                accountId: id,
                postId: item.postId,
                likes: item.likes,
                source: "channel_feedback",
              },
            ],
          );
          await tx.query(
            "INSERT INTO feedback_comment(workspace_id,account_id,external_id,content_hash,item_id,scope_id) VALUES($1,$2,$3,$4,$5,$6)",
            [workspaceId, id, item.id, hash, r.rows[0]!.id, scope],
          );
          inserted++;
        }
        if (scan.requested_range === "since")
          await tx.query(
            `INSERT INTO feedback_source_state(workspace_id,account_id,last_success_at,checkpoint,scope_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,account_id,scope_id) DO UPDATE SET last_success_at=COALESCE(EXCLUDED.last_success_at,feedback_source_state.last_success_at),checkpoint=EXCLUDED.checkpoint,updated_at=now()`,
            [
              workspaceId,
              id,
              result.complete
                ? (input.state?.checkpoint?.until ?? scan.until_at)
                : null,
              result.checkpoint,
              scope,
            ],
          );
        coverage.push({
          accountId: id,
          displayName: input.account.displayName,
          complete: result.complete && result.missingDates === 0,
          error: result.error,
          inserted,
          duplicates,
          postsWindowDays: result.postsWindowDays,
          recentPostsLimit: result.postsWindowDays === 0 ? 25 : null,
          missingDates: result.missingDates,
          scope: "public_comments_accessible_posts",
        });
        await tx.query(
          "UPDATE feedback_scan SET coverage=$3 WHERE workspace_id=$1 AND id=$2",
          [workspaceId, scanId, JSON.stringify(coverage)],
        );
      });
    }
    await this.database.withWorkspace(workspaceId, async (tx) => {
      const count = await tx.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM import_item WHERE workspace_id=$1 AND batch_id=$2",
        [workspaceId, scan.batch_id],
      );
      const n = Number(count.rows[0]?.n ?? 0);
      const partial = coverage.some((c) => !c.complete);
      const failed = coverage.every((c) => c.error) && n === 0;
      await tx.query(
        "UPDATE import_batch SET status=$4,classified_at=CASE WHEN $4='classified' THEN now() ELSE NULL END,item_count=$3 WHERE workspace_id=$1 AND id=$2",
        [workspaceId, scan.batch_id, n, partial ? "pending" : "classified"],
      );
      await tx.query(
        "UPDATE feedback_scan SET status=$3,item_count=$4,coverage=$5,finished_at=now() WHERE workspace_id=$1 AND id=$2",
        [
          workspaceId,
          scanId,
          failed ? "failed" : partial ? "partial" : "completed",
          n,
          JSON.stringify(coverage),
        ],
      );
      if (scan.schedule_id) {
        // Partial collection requires human review; never silently bill an incomplete daily run.
        const current = await tx.query<{ enabled: boolean; version: number }>(
          "SELECT enabled,version FROM feedback_schedule WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
          [workspaceId, scan.schedule_id],
        );
        const s = scan.schedule_snapshot;
        if (!n && !partial) return; // Empty successful collection never checks or consumes AI credits.
        const usage = await usageSnapshot(tx);
        const error = partial
          ? "feedback_partial_requires_review"
          : !current.rows[0]?.enabled || current.rows[0].version !== s.version
            ? "schedule_changed"
            : meteringMode() !== "cost-v1"
              ? "feedback_schedule_requires_cost_metering"
              : usage.aiCreditsAvailable < s.daily_credits
                ? "ai_budget_insufficient"
                : null;
        if (error) {
          await tx.query(
            "UPDATE feedback_scan SET analysis_error=$3 WHERE workspace_id=$1 AND id=$2",
            [workspaceId, scanId, error],
          );
          if (error !== "schedule_changed")
            await tx.query(
              "UPDATE feedback_schedule SET enabled=false,last_error=$3 WHERE workspace_id=$1 AND id=$2",
              [workspaceId, scan.schedule_id, error],
            );
          return;
        }
        if (!n) return; // No new data -> no model, no quote, no charge.
        const rate =
          ratesFromEnv()[s.model_band as "eco" | "standard" | "flagship"];
        rateForTime(rate, new Date().toISOString());
        const report = await tx.query<{ id: string }>(
          `INSERT INTO insight_report(workspace_id,template,title,model_band,batch_ids,item_count,created_by,goal) VALUES($1,'daily_ops',$2,$3,$4,$5,$6,$7) RETURNING id`,
          [
            workspaceId,
            s.name,
            s.model_band,
            JSON.stringify([scan.batch_id]),
            n,
            scan.created_by,
            s.goal,
          ],
        );
        const reportId = report.rows[0]!.id;
        await tx.query(
          `INSERT INTO ai_cost_operation(workspace_id,actor_id,kind,band,rate,estimated_credits,max_credits,max_calls,mode,policy_version,subject_id,accepted_at,state) VALUES($1,$2,'insight.generate',$3,$4,$5,$5,1,'cost-v1',$6,$7,now(),'accepted')`,
          [
            workspaceId,
            scan.created_by,
            s.model_band,
            JSON.stringify(rate),
            s.daily_credits,
            COST_VERSION,
            reportId,
          ],
        );
        await tx.query(
          "INSERT INTO job(workspace_id,kind,payload) VALUES($1,'insight.generate',$2)",
          [
            workspaceId,
            { reportId, language: s.language, scheduleId: scan.schedule_id },
          ],
        );
        await tx.query(
          "UPDATE feedback_scan SET report_id=$3 WHERE workspace_id=$1 AND id=$2",
          [workspaceId, scanId, reportId],
        );
      }
    });
  }
}
