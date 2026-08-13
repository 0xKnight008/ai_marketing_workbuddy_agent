import assert from 'node:assert/strict';
import test from 'node:test';

import { assertDraftsWithinPolicy, assertRunInputWithinPolicy } from './run-policy';

const context = {
  approvalPolicy: 'required' as const,
  brandProfile: { tone: 'clear', language: 'en', forbiddenWords: [] },
  priorApprovedExamples: [],
  runPolicy: { approvalRequiredForPublish: true, modelBand: 'eco' as const, llmProvider: 'primary' as const, maxInputTokens: 8_000, maxOutputTokens: 1_500, maxTargets: 1 },
};

test('enforces the selected model band target limit before generation', () => {
  assert.throws(
    () => assertRunInputWithinPolicy({ mode: 'draft', brief: 'Launch', targets: [{ platform: 'x', accountId: 'one' }, { platform: 'linkedin', accountId: 'two' }] }, context),
    /Target count exceeds the eco plan limit/,
  );
});

test('enforces an output cap after structured generation', () => {
  const strictContext = { ...context, runPolicy: { ...context.runPolicy, maxOutputTokens: 2 } };
  assert.throws(
    () => assertDraftsWithinPolicy([{ platform: 'x', accountId: 'one', content: 'This is intentionally long', hashtags: [], characterCount: 24 }], strictContext),
    /Output exceeds the eco plan limit/,
  );
});
