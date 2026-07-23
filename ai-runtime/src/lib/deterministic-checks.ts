import type { BrandProfile, ComplianceIssue, Draft } from '../schemas/announcement';

/**
 * 确定性执行时校验（§3.5 “执行时校验”）。
 * 规则来自代码而非模型，保证可复现、可单测。
 */

const PLATFORM_LENGTH_LIMITS: Record<string, number> = {
  x: 280,
  telegram: 4096,
  discord: 2000,
  linkedin: 3000,
  instagram: 2200,
  reddit: 40000,
  substack: 100000,
  tiktok: 2200,
  youtube: 5000,
  rednote: 1000,
};

export function runDeterministicChecks(
  drafts: Draft[],
  brandProfile: BrandProfile,
): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];

  for (const draft of drafts) {
    const where = { platform: draft.platform, accountId: draft.accountId } as const;
    // Connector services commonly append hashtags to the copy at publish time, so
    // deterministic checks must evaluate the complete outbound text, not only
    // the model's `content` field.
    const publishableText = [draft.content, ...draft.hashtags].filter(Boolean).join(' ');

    // 1. 禁用词
    const lowered = publishableText.toLowerCase();
    for (const word of brandProfile.forbiddenWords) {
      if (word && lowered.includes(word.toLowerCase())) {
        issues.push({
          ...where,
          severity: 'blocker',
          rule: 'forbidden_word',
          message: `Content contains forbidden word "${word}".`,
        });
      }
    }

    // 2. 平台长度上限
    const limit = PLATFORM_LENGTH_LIMITS[draft.platform];
    const actualPublishedLength = publishableText.length;
    if (limit !== undefined && actualPublishedLength > limit) {
      issues.push({
        ...where,
        severity: 'blocker',
        rule: 'length_limit',
        message: `Published text length ${actualPublishedLength} exceeds ${draft.platform} limit ${limit}.`,
      });
    }

    // 3. characterCount 与实际不符（agent 输出校验）
    const actual = draft.content.length;
    if (draft.characterCount !== actual) {
      issues.push({
        ...where,
        severity: 'warning',
        rule: 'character_count_mismatch',
        message: `Declared characterCount ${draft.characterCount} != actual ${actual}.`,
      });
    }
  }

  return issues;
}
