import { createHash } from 'node:crypto';

const actionCapabilities = {
  'social.create_post': 'publish',
  'social.schedule_post': 'schedule',
  'social.get_analytics': 'analytics',
} as const;

export type ConnectorActionType = keyof typeof actionCapabilities;

export interface ConnectedAccountView {
  id: string;
  workspaceId: string;
  status: 'connected' | 'expired' | 'disconnected' | 'syncing';
  capabilities: string[];
}

export interface ConnectorActionRequest {
  workspaceId: string;
  runId: string;
  stepId: string;
  attempt: number;
  account: ConnectedAccountView;
  type: ConnectorActionType;
  payload: Record<string, unknown>;
}

export function assertExecutableAction(request: ConnectorActionRequest): void {
  if (request.account.workspaceId !== request.workspaceId) throw new Error('Connected account is outside this workspace');
  if (request.account.status !== 'connected') throw new Error(`Connected account is not available: ${request.account.status}`);
  const requiredCapability = actionCapabilities[request.type];
  if (!request.account.capabilities.includes(requiredCapability)) {
    throw new Error(`Connected account lacks capability: ${requiredCapability}`);
  }
  if (!Number.isSafeInteger(request.attempt) || request.attempt < 1) throw new Error('attempt must be a positive integer');
}

export function actionIdempotencyKey(request: ConnectorActionRequest): string {
  const stable = JSON.stringify({ runId: request.runId, stepId: request.stepId, attempt: request.attempt, accountId: request.account.id, type: request.type, payload: request.payload });
  return createHash('sha256').update(stable).digest('hex');
}
