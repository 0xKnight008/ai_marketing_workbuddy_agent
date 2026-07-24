import type { ApprovalStatus, RunStatus, StepStatus } from '../contracts/domain';

const allowedTransitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  pending: ['queued', 'cancelled'],
  queued: ['running', 'cancelled', 'dead_lettered'],
  running: ['waiting_approval', 'succeeded', 'failed', 'cancelled', 'timed_out'],
  waiting_approval: ['queued', 'cancelled', 'timed_out'],
  succeeded: [],
  failed: ['queued', 'dead_lettered'],
  cancelled: [],
  timed_out: ['queued', 'dead_lettered'],
  dead_lettered: [],
};

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!allowedTransitions[from].includes(to)) throw new Error(`Invalid run transition: ${from} -> ${to}`);
}

export function nextStatusAfterApproval(decision: ApprovalStatus): RunStatus {
  if (decision === 'approved') return 'queued';
  if (decision === 'rejected' || decision === 'cancelled') return 'cancelled';
  throw new Error(`Approval decision ${decision} cannot resume a run`);
}

export function completionStepStatus(runStatus: RunStatus): StepStatus {
  if (runStatus === 'succeeded') return 'succeeded';
  if (runStatus === 'cancelled') return 'cancelled';
  if (runStatus === 'waiting_approval') return 'waiting_approval';
  if (runStatus === 'failed' || runStatus === 'timed_out' || runStatus === 'dead_lettered') return 'failed';
  throw new Error(`${runStatus} is not a terminal step state`);
}
