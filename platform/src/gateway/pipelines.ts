import { z } from 'zod';

import type { ActorContext } from '../contracts/domain';
import type { TenantTransaction } from '../foundation/database';
import { requirePermission } from '../foundation/rbac';

export const pipelineTemplates = [
  {
    id: 'repurpose',
    name: 'Repurpose and schedule',
    description: 'Turn one campaign brief into channel-ready posts and route publishing through approval.',
    steps: ['Brief', 'AI drafts', 'Review', 'Schedule'],
    definitionSteps: [{ type: 'ai.prepare_announcement' }, { type: 'approval' }, { type: 'social.schedule_post' }],
  },
  {
    id: 'weekly_report',
    name: 'Weekly growth report',
    description: 'Collect account performance, summarize the week, and send an approval-ready report.',
    steps: ['Weekly trigger', 'Pull analytics', 'AI summary', 'Review'],
    definitionSteps: [{ type: 'social.get_analytics' }, { type: 'ai.summarize' }, { type: 'approval' }],
  },
  {
    id: 'comment_lead',
    name: 'Comment-to-lead review',
    description: 'Find high-intent comments, classify them, and queue qualified leads for review.',
    steps: ['Watch comments', 'AI classify', 'Review', 'Hand off'],
    definitionSteps: [{ type: 'social.read_comments' }, { type: 'ai.classify' }, { type: 'approval' }],
  },
] as const;

export type PipelineTemplateId = typeof pipelineTemplates[number]['id'];

const templateIdSchema = z.enum(['repurpose', 'weekly_report', 'comment_lead']);
const sourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('template'), templateId: templateIdSchema }),
  z.object({ type: z.literal('description'), description: z.string().trim().min(10).max(2_000) }),
]);
const targetAccountIdsSchema = z.array(z.string().uuid()).max(20).refine(
  (ids) => new Set(ids).size === ids.length,
  'Destination accounts must be unique',
);

const createPipelineSchema = z.object({
  name: z.string().trim().min(3).max(100),
  source: sourceSchema,
  configuration: z.object({
    brief: z.string().trim().min(10).max(4_000),
    targetAccountIds: targetAccountIdsSchema.default([]),
    approvalPolicy: z.enum(['required', 'auto_approve']).default('required'),
    tone: z.string().trim().min(2).max(200).default('clear, helpful'),
    language: z.string().trim().min(2).max(10).default('en'),
  }),
}).strict();

export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;

export interface PipelineDefinition {
  kind: 'pipeline';
  source: CreatePipelineInput['source'];
  brief: string;
  targetAccountIds: string[];
  approvalPolicy: 'required' | 'auto_approve';
  tone: string;
  language: string;
  steps: Array<{ type: string }>;
}

export interface PipelineView {
  id: string;
  name: string;
  status: 'draft' | 'published' | 'archived';
  version: number;
  updatedAt: string;
  definition: PipelineDefinition;
  lastRunStatus?: string;
}

type StoredPipelineRow = Omit<PipelineView, 'definition'> & { definition: unknown };

export interface ConnectedAccountView {
  id: string;
  externalAccountId: string;
  displayName: string;
  platform: string;
  capabilities: string[];
  status: 'connected' | 'expired' | 'disconnected' | 'syncing';
  lastSyncedAt?: string;
}

export interface PipelineCheck {
  id: 'brief' | 'accounts' | 'account_health' | 'approval';
  label: string;
  passed: boolean;
  detail: string;
}

export interface PipelineReadiness {
  ready: boolean;
  checks: PipelineCheck[];
}

export function listPipelineTemplates(): Array<{ id: PipelineTemplateId; name: string; description: string; steps: readonly string[] }> {
  return pipelineTemplates.map(({ id, name, description, steps }) => ({ id, name, description, steps }));
}

export async function createPipelineDraft(tx: TenantTransaction, actor: ActorContext, input: unknown): Promise<PipelineView> {
  requirePermission(actor.role, 'workflow:edit');
  const parsed = createPipelineSchema.parse(input);
  const definition = definitionFrom(parsed);
  const created = await tx.query<{ id: string; updatedAt: string }>(
    `INSERT INTO workflow (workspace_id, name, status, current_version, created_by)
     VALUES ($1, $2, 'draft', 1, $3)
     RETURNING id, updated_at::text AS "updatedAt"`,
    [actor.workspaceId, parsed.name, actor.actorId],
  );
  const row = created.rows[0];
  if (!row) throw new Error('Pipeline creation failed');
  await tx.query(
    'INSERT INTO workflow_version (workflow_id, version, definition, created_by) VALUES ($1, 1, $2, $3)',
    [row.id, definition, actor.actorId],
  );
  await tx.query(
    'INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)',
    [actor.workspaceId, actor.actorId, 'pipeline.draft_created', { pipelineId: row.id, source: parsed.source }],
  );
  return { id: row.id, name: parsed.name, status: 'draft', version: 1, updatedAt: row.updatedAt, definition };
}

export async function updatePipelineDraft(tx: TenantTransaction, actor: ActorContext, pipelineId: string, input: unknown): Promise<PipelineView> {
  requirePermission(actor.role, 'workflow:edit');
  const parsedId = z.string().uuid().parse(pipelineId);
  const parsed = createPipelineSchema.parse(input);
  const definition = definitionFrom(parsed);
  const updated = await tx.query<{ id: string; name: string; status: 'draft'; version: number; updatedAt: string }>(
    `UPDATE workflow
        SET name = $3, current_version = current_version + 1, updated_at = now()
      WHERE id = $1 AND workspace_id = $2 AND status = 'draft'
      RETURNING id, name, status, current_version AS version, updated_at::text AS "updatedAt"`,
    [parsedId, actor.workspaceId, parsed.name],
  );
  const row = updated.rows[0];
  if (!row) throw new Error('Pipeline draft was not found or is already active');
  await tx.query(
    'INSERT INTO workflow_version (workflow_id, version, definition, created_by) VALUES ($1, $2, $3, $4)',
    [row.id, row.version, definition, actor.actorId],
  );
  await tx.query(
    'INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)',
    [actor.workspaceId, actor.actorId, 'pipeline.draft_updated', { pipelineId: row.id, version: row.version }],
  );
  return { ...row, definition };
}

export async function listPipelines(tx: TenantTransaction, actor: ActorContext): Promise<PipelineView[]> {
  requirePermission(actor.role, 'workflow:run');
  const result = await tx.query<StoredPipelineRow>(
    `SELECT w.id, w.name, w.status, w.current_version AS version, w.updated_at::text AS "updatedAt",
            v.definition,
            (SELECT wr.status::text FROM workflow_run wr WHERE wr.workflow_id = w.id ORDER BY wr.created_at DESC LIMIT 1) AS "lastRunStatus"
       FROM workflow w
       JOIN workflow_version v ON v.workflow_id = w.id AND v.version = w.current_version
      WHERE w.workspace_id = $1
      ORDER BY w.updated_at DESC`,
    [actor.workspaceId],
  );
  return result.rows.map((row) => ({ ...row, definition: normalizeStoredDefinition(row.definition, row.name) }));
}

export async function listConnectedAccounts(tx: TenantTransaction, actor: ActorContext): Promise<ConnectedAccountView[]> {
  requirePermission(actor.role, 'workflow:run');
  const result = await tx.query<ConnectedAccountView>(
    `SELECT id, external_account_id AS "externalAccountId", display_name AS "displayName",
            platform, capabilities, status, last_synced_at::text AS "lastSyncedAt"
       FROM connected_account
      WHERE workspace_id = $1 AND provider = 'zernio'
      ORDER BY CASE status WHEN 'connected' THEN 0 ELSE 1 END, platform, display_name`,
    [actor.workspaceId],
  );
  return result.rows;
}

export async function inspectPipelineReadiness(tx: TenantTransaction, actor: ActorContext, pipelineId: string): Promise<PipelineReadiness> {
  requirePermission(actor.role, 'workflow:run');
  const pipeline = await loadPipeline(tx, actor.workspaceId, pipelineId);
  const selectedIds = pipeline.definition.targetAccountIds;
  const accounts = selectedIds.length === 0 ? [] : (await tx.query<{ id: string; status: string }>(
    `SELECT id, status FROM connected_account
      WHERE workspace_id = $1 AND provider = 'zernio' AND id = ANY($2::uuid[])`,
    [actor.workspaceId, selectedIds],
  )).rows;
  const connected = accounts.filter((account) => account.status === 'connected').length;
  const checks: PipelineCheck[] = [
    { id: 'brief', label: 'Clear automation brief', passed: pipeline.definition.brief.trim().length >= 10, detail: 'The pipeline has enough context for its AI and review steps.' },
    { id: 'accounts', label: 'Destination selected', passed: selectedIds.length > 0, detail: selectedIds.length > 0 ? `${selectedIds.length} account${selectedIds.length === 1 ? '' : 's'} selected.` : 'Choose at least one connected social account.' },
    { id: 'account_health', label: 'Accounts are healthy', passed: selectedIds.length > 0 && connected === selectedIds.length, detail: selectedIds.length > 0 && connected === selectedIds.length ? 'Every selected account is connected.' : 'Reconnect or replace unavailable accounts before activation.' },
    { id: 'approval', label: 'Approval guardrail', passed: pipeline.definition.steps.some((step) => step.type === 'approval'), detail: 'Publishing remains behind the configured approval policy.' },
  ];
  return { ready: checks.every((check) => check.passed), checks };
}

export async function activatePipeline(tx: TenantTransaction, actor: ActorContext, pipelineId: string): Promise<PipelineView> {
  requirePermission(actor.role, 'workflow:edit');
  const readiness = await inspectPipelineReadiness(tx, actor, pipelineId);
  if (!readiness.ready) throw new Error('Pipeline is not ready to activate');
  const activated = await tx.query<PipelineView>(
    `UPDATE workflow
        SET status = 'published', updated_at = now()
      WHERE id = $1 AND workspace_id = $2 AND status IN ('draft', 'published')
      RETURNING id, name, status, current_version AS version, updated_at::text AS "updatedAt"`,
    [pipelineId, actor.workspaceId],
  );
  const row = activated.rows[0];
  if (!row) throw new Error('Pipeline was not found or cannot be activated');
  const loaded = await loadPipeline(tx, actor.workspaceId, pipelineId);
  await tx.query(
    'INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)',
    [actor.workspaceId, actor.actorId, 'pipeline.activated', { pipelineId, version: row.version }],
  );
  return { ...row, definition: loaded.definition };
}

async function loadPipeline(tx: TenantTransaction, workspaceId: string, pipelineId: string): Promise<PipelineView> {
  const parsedId = z.string().uuid().parse(pipelineId);
  const result = await tx.query<PipelineView>(
    `SELECT w.id, w.name, w.status, w.current_version AS version, w.updated_at::text AS "updatedAt", v.definition
       FROM workflow w
       JOIN workflow_version v ON v.workflow_id = w.id AND v.version = w.current_version
      WHERE w.id = $1 AND w.workspace_id = $2 AND COALESCE(v.definition->>'kind', '') = 'pipeline'`,
    [parsedId, workspaceId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Pipeline was not found');
  return row;
}

function definitionFrom(parsed: CreatePipelineInput): PipelineDefinition {
  const templateId = parsed.source.type === 'template' ? parsed.source.templateId : undefined;
  const template = templateId ? pipelineTemplates.find((candidate) => candidate.id === templateId) : undefined;
  return {
    kind: 'pipeline',
    source: parsed.source,
    brief: parsed.configuration.brief,
    targetAccountIds: parsed.configuration.targetAccountIds,
    approvalPolicy: parsed.configuration.approvalPolicy,
    tone: parsed.configuration.tone,
    language: parsed.configuration.language,
    steps: template?.definitionSteps.map((step) => ({ ...step })) ?? [
      { type: 'ai.prepare_announcement' },
      { type: 'approval' },
      { type: 'social.schedule_post' },
    ],
  };
}

function normalizeStoredDefinition(value: unknown, name: string): PipelineDefinition {
  const parsed = z.object({
    kind: z.literal('pipeline'),
    source: sourceSchema,
    brief: z.string(),
    targetAccountIds: targetAccountIdsSchema,
    approvalPolicy: z.enum(['required', 'auto_approve']),
    tone: z.string(),
    language: z.string(),
    steps: z.array(z.object({ type: z.string() })),
  }).safeParse(value);
  if (parsed.success) return parsed.data;
  const legacy = z.object({ steps: z.array(z.object({ type: z.string() })).default([]) }).safeParse(value);
  return {
    kind: 'pipeline',
    source: { type: 'description', description: `Imported workflow: ${name}` },
    brief: name,
    targetAccountIds: [],
    approvalPolicy: 'required',
    tone: 'clear, helpful',
    language: 'en',
    steps: legacy.success ? legacy.data.steps : [],
  };
}
