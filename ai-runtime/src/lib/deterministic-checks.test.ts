import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareAnnouncementRequestSchema } from '../schemas/announcement';
import { resolveApprovalRequirement } from './approval-policy';
import { runDeterministicChecks } from './deterministic-checks';
import { assertTargetsMatch } from './target-validation';

test('rejects duplicate publish targets before a run is created', () => {
  const parsed = prepareAnnouncementRequestSchema.safeParse({
    platformRunId: 'run_123',
    workspaceId: 'ws_123',
    actorId: 'user_123',
    input: {
      brief: 'Launch announcement',
      targets: [
        { platform: 'x', accountId: 'account_123' },
        { platform: 'x', accountId: 'account_123' },
      ],
    },
  });

  assert.equal(parsed.success, false);
});

test('checks forbidden words and length against the complete outbound text', () => {
  const issues = runDeterministicChecks(
    [
      {
        platform: 'x',
        accountId: 'account_123',
        content: 'x'.repeat(281),
        hashtags: ['#guaranteed'],
        // An LLM-provided count must not be trusted for limit enforcement.
        characterCount: 0,
      },
    ],
    { tone: 'clear', language: 'en', forbiddenWords: ['guaranteed'] },
  );

  assert.deepEqual(
    issues.map((issue) => issue.rule).sort(),
    ['character_count_mismatch', 'forbidden_word', 'length_limit'],
  );
  assert.equal(issues.filter((issue) => issue.severity === 'blocker').length, 2);
});

test('rejects model output that changes the requested account', () => {
  assert.throws(
    () =>
      assertTargetsMatch(
        [{ platform: 'x', accountId: 'account_123' }],
        [{ platform: 'x', accountId: 'account_456' }],
        'drafts',
      ),
    /do not match the requested platform\/account targets/,
  );
});

test('semantic compliance output cannot remove the approval gate', () => {
  assert.equal(
    resolveApprovalRequirement({
      approvalPolicy: 'auto_approve',
      brandProfile: { tone: 'clear', language: 'en', forbiddenWords: [] },
      priorApprovedExamples: [],
      runPolicy: { approvalRequiredForPublish: false },
    }),
    true,
  );
});
