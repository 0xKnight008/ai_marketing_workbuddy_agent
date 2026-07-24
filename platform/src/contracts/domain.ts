export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'approver' | 'viewer';
export type RunStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'dead_lettered';
export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'waiting_approval' | 'cancelled';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';

export interface ActorContext {
  actorId: string;
  workspaceId: string;
  role: WorkspaceRole;
}

export interface BrandContextSnapshot {
  tone: string;
  language: string;
  forbiddenWords: string[];
  approvalPolicy: 'required' | 'auto_approve' | 'none';
  allowedModelClasses: string[];
}

export interface WorkflowRunRequest {
  workflowId: string;
  workflowVersion: number;
  idempotencyKey: string;
  input: Record<string, unknown>;
  context: BrandContextSnapshot;
}
