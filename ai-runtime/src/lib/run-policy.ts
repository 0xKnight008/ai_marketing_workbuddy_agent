import type { Draft, ExecutionContext, PrepareAnnouncementInput } from '../schemas/announcement';

function approximateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

export function assertRunInputWithinPolicy(input: PrepareAnnouncementInput, context: ExecutionContext): void {
  if (input.targets.length > context.runPolicy.maxTargets) {
    throw new Error(`Target count exceeds the ${context.runPolicy.modelBand} plan limit`);
  }
  if (approximateTokens(input) > context.runPolicy.maxInputTokens) {
    throw new Error(`Input exceeds the ${context.runPolicy.modelBand} context limit`);
  }
}

export function assertDraftsWithinPolicy(drafts: Draft[], context: ExecutionContext): void {
  if (approximateTokens(drafts) > context.runPolicy.maxOutputTokens) {
    throw new Error(`Output exceeds the ${context.runPolicy.modelBand} plan limit`);
  }
}
