import assert from 'node:assert/strict';
import test from 'node:test';

import { HttpError, publicError } from './errors';

test('publicError surfaces the actionable HttpError message alongside the code', () => {
  const result = publicError(new HttpError(422, 'import_field_too_long', 'CSV row 3: text is 2840 chars (max 2000)'));
  assert.equal(result.statusCode, 422);
  assert.equal(result.body.error, 'import_field_too_long');
  assert.equal(result.body.message, 'CSV row 3: text is 2840 chars (max 2000)');
});

test('publicError preserves the code-only response when no distinct message is supplied', () => {
  const result = publicError(new HttpError(402, 'subscription_required'));
  assert.deepEqual(result.body, { error: 'subscription_required' });
});

test('publicError does not expose internal server-error messages', () => {
  assert.deepEqual(publicError(new HttpError(503, 'service_unavailable', 'private database details')).body, { error: 'service_unavailable' });
});
