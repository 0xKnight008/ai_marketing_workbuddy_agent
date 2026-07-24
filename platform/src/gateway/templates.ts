import type { ActorContext } from '../contracts/domain';
import type { TenantTransaction } from '../foundation/database';
import { requirePermission } from '../foundation/rbac';

const templates = {
  repurpose: { name: 'Repurpose and schedule', steps: [{ type: 'ai.prepare_announcement' }, { type: 'approval' }, { type: 'social.schedule_post' }] },
  weekly_report: { name: 'Weekly growth report', steps: [{ type: 'social.get_analytics' }, { type: 'ai.summarize' }, { type: 'approval' }] },
  comment_lead: { name: 'Comment-to-lead review', steps: [{ type: 'social.read_comments' }, { type: 'ai.classify' }, { type: 'approval' }] },
} as const;

export type TemplateId = keyof typeof templates;

export async function createPublishedTemplate(tx: TenantTransaction, actor: ActorContext, templateId: TemplateId): Promise<{ workflowId: string; version: number; name: string }> {
  requirePermission(actor.role, 'workflow:edit');
  const template = templates[templateId];
  if (!template) throw new Error('Unsupported template');
  const workflow = await tx.query<{ id: string }>("INSERT INTO workflow (workspace_id, name, status, current_version, created_by) VALUES ($1, $2, 'published', 1, $3) RETURNING id", [actor.workspaceId, template.name, actor.actorId]);
  const workflowId = workflow.rows[0]?.id;
  if (!workflowId) throw new Error('Workflow creation failed');
  await tx.query('INSERT INTO workflow_version (workflow_id, version, definition, created_by) VALUES ($1, 1, $2, $3)', [workflowId, template, actor.actorId]);
  await tx.query('INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)', [actor.workspaceId, actor.actorId, 'workflow.published', { workflowId, templateId }]);
  return { workflowId, version: 1, name: template.name };
}
