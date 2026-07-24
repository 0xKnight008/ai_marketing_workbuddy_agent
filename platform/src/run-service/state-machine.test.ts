import assert from 'node:assert/strict';
import test from 'node:test';

import { assertRunTransition, nextStatusAfterApproval } from './state-machine';

test('runs cannot publish before an approval decision resumes them', () => {
  assert.throws(() => assertRunTransition('waiting_approval', 'succeeded'), /Invalid/);
  assert.equal(nextStatusAfterApproval('approved'), 'queued');
  assert.equal(nextStatusAfterApproval('rejected'), 'cancelled');
});
