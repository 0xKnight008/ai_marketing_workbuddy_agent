import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAnnouncementOutput } from './announcement-output';
import { draftSetSchema } from '../schemas/announcement';
const draft = { drafts: [{ platform: 'x', accountId: 'fixture', content: 'New launch', hashtags: [], characterCount: 10 }] };
test('parses object or complete JSON text from the same response', () => {
  for (const response of [{ object: draft }, { text: JSON.stringify(draft) }, { text: '```json\n' + JSON.stringify(draft) + '\n```' }])
    assert.deepEqual(parseAnnouncementOutput(draftSetSchema, { ...response, finishReason: 'stop' }), draft);
});
test('reasoning-only length response reports truncation instead of Zod Required', () => {
  assert.throws(() => parseAnnouncementOutput(draftSetSchema, { text: '', finishReason: 'length' }), /pipeline_output_truncated/);
  // A syntactically valid partial object must not bypass a length stop.
  assert.throws(() => parseAnnouncementOutput(draftSetSchema, { object: draft, finishReason: 'length' }), /pipeline_output_truncated/);
});
test('invalid, empty and filtered output cannot become a reviewable draft', () => {
  for (const [result, code] of [
    [{ text: '' }, 'empty'], [{ text: '{' }, 'invalid_json'],
    [{ object: { drafts: [] } }, 'invalid_schema'],
    [{ object: draft, finishReason: 'content-filter' }, 'filtered'],
    [{ object: draft, finishReason: 'tool-calls' }, 'incomplete'],
  ] as const) assert.throws(() => parseAnnouncementOutput(draftSetSchema, result), new RegExp('pipeline_output_' + code));
});
