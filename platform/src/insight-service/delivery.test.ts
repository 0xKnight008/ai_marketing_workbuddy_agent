import assert from 'node:assert/strict';
import test from 'node:test';

import { renderReportDigest, sendReportEmail } from './delivery';

type FetchCall = { url: string; init: RequestInit };

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init as RequestInit });
    return impl(String(url), init);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('renderReportDigest includes summary, highlights and evidence line', () => {
  const digest = renderReportDigest({
    template: 'daily_ops',
    title: '每日运营任务 · 2026-09-11',
    itemCount: 42,
    droppedCitations: 2,
    report: {
      summary: '今天优先处理包装差评。',
      tasks: [
        { title: '回复包装差评', reason: 'r', suggestedAction: '联系买家补偿', priority: 'urgent', dueHint: 'today', citations: [] },
        { title: '发起预售投票', reason: 'r', suggestedAction: '发帖', priority: 'normal', dueHint: 'this week', citations: [] },
      ],
    },
  });
  assert.ok(digest.includes('每日运营任务 · 2026-09-11'));
  assert.ok(digest.includes('今天优先处理包装差评。'));
  assert.ok(digest.includes('[urgent] 回复包装差评 — 联系买家补偿'));
  assert.ok(digest.includes('基于 42 条导入内容'));
  assert.ok(digest.includes('2 条不可验证的引用已被自动丢弃'));
  assert.ok(digest.includes('完整报告'));
});

test('renderReportDigest skips malformed entries and omits dropped line at zero', () => {
  const digest = renderReportDigest({
    template: 'content_recap',
    title: 'T',
    itemCount: 1,
    droppedCitations: 0,
    report: {
      summary: 's',
      successFactors: [{ factor: '钩子强', detail: '前 3 秒' }, { nope: 1 }],
      nextTopics: ['幕后花絮'],
    },
  });
  assert.ok(digest.includes('钩子强 — 前 3 秒'));
  assert.ok(digest.includes('选题建议: 幕后花絮'));
  assert.ok(!digest.includes('不可验证'));
});

test('renderReportDigest degrades gracefully when summary is missing', () => {
  const digest = renderReportDigest({ template: 'community_digest', title: 'T', itemCount: 3, droppedCitations: 0, report: {} });
  assert.ok(digest.includes('（无摘要）'));
  assert.ok(digest.includes('基于 3 条导入内容'));
});

test('sendReportEmail posts to Resend with idempotency key and recipient', async () => {
  const { calls, restore } = stubFetch(async () => new Response(JSON.stringify({ id: 'email-1' }), { status: 200 }));
  try {
    await sendReportEmail(
      { apiKey: 'rk_test', from: 'reports@piggybot.app' },
      { to: 'owner@example.com', subject: '[Piggybot] T', text: 'body', idempotencyKey: 'insight-delivery/job-1' },
    );
  } finally {
    restore();
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://api.resend.com/emails');
  const headers = calls[0]?.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer rk_test');
  assert.equal(headers['Idempotency-Key'], 'insight-delivery/job-1');
  const body = JSON.parse(String(calls[0]?.init.body)) as { from: string; to: string[]; subject: string };
  assert.equal(body.from, 'reports@piggybot.app');
  assert.deepEqual(body.to, ['owner@example.com']);
});

test('sendReportEmail throws on Resend rejection', async () => {
  const { restore } = stubFetch(async () => new Response('bad', { status: 422 }));
  try {
    await assert.rejects(
      () => sendReportEmail({ apiKey: 'rk', from: 'f@example.com' }, { to: 'x@y.z', subject: 's', text: 't', idempotencyKey: 'k' }),
      /email_rejected/,
    );
  } finally {
    restore();
  }
});
