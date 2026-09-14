import test from 'node:test';
import assert from 'node:assert/strict';
import { reportDrafts } from '../../../shared/report-drafts';
import { requestInsightDeliverySchema } from '../contracts/insights';

test('all six templates expose saved drafts and ignore unrelated or blank fields', () => {
  const cases = [
    ['content_recap', { draftScripts: [{ body: 'Script' }] }, 'draftScripts:0'],
    ['comment_insights', { highValueComments: [{ replyDraft: 'Reply' }] }, 'highValueComments:0'],
    ['product_opportunities', { presalePollDraft: 'Full poll text' }, 'presalePollDraft'],
    ['review_attribution', { serviceReplyDrafts: [{ replyDraft: 'Apology' }] }, 'serviceReplyDrafts:0'],
    ['community_digest', { announcementDraft: 'Announcement' }, 'announcementDraft'],
    ['daily_ops', { tasks: [{ draftCopy: 'Task copy' }] }, 'tasks:0'],
  ] as const;
  for (const [template, report, key] of cases) assert.equal(reportDrafts(template, report)[0]?.key, key);
  assert.deepEqual(reportDrafts('daily_ops', { tasks: [{ draftCopy: ' ' }], arbitrary: 'injected' }), []);
  assert.equal(requestInsightDeliverySchema.safeParse({ channel: 'email', content: 'client override' }).success, false);
});
