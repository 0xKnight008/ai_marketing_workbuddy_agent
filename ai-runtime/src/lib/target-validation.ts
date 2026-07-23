import type { Target } from '../schemas/announcement';

/**
 * A model may produce syntactically valid structured output for the wrong
 * account. Never let model output expand or alter the caller-authorized target
 * set before it becomes an executable action plan.
 */
export function assertTargetsMatch(
  expectedTargets: Target[],
  actualTargets: Array<Pick<Target, 'platform' | 'accountId'>>,
  label: string,
): void {
  if (actualTargets.length !== expectedTargets.length) {
    throw new Error(`${label} must contain exactly one entry for each requested target`);
  }

  const expected = new Set(expectedTargets.map(targetKey));
  const actual = new Set(actualTargets.map(targetKey));
  if (actual.size !== expected.size || [...actual].some((key) => !expected.has(key))) {
    throw new Error(`${label} do not match the requested platform/account targets`);
  }
}

function targetKey(target: Pick<Target, 'platform' | 'accountId'>): string {
  return `${target.platform}:${target.accountId}`;
}
