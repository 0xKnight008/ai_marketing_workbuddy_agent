import type { ExecutionContext } from '../schemas/announcement';

/**
 * Semantic compliance is LLM output and is therefore advisory only. It must
 * never be the signal that removes a human approval gate.
 */
export function resolveApprovalRequirement(ctx: ExecutionContext): boolean {
  // `none` is an explicit, trusted run-service override. Every normal mode,
  // including auto_approve, retains approval while semantic review is present.
  return ctx.approvalPolicy !== 'none';
}
