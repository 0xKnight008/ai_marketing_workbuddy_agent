import { test, expect } from '@playwright/test';

const run = { id: 'run-1', status: 'completed', modelBand: 'eco', itemCount: 3, topicCount: 2, error: null, createdAt: '2026-09-14', completedAt: '2026-09-14' };
const topics = [
  { id: 'topic-1', runId: 'run-1', key: 'tiktok_shop_import', label: 'TikTok Shop import', description: 'Requests to import TikTok Shop comments', itemCount: 2 },
  { id: 'topic-2', runId: 'run-1', key: 'pricing_question', label: 'Pricing question', description: 'Questions about plan pricing', itemCount: 1 },
];

test('topics show verified counts, audit modal highlights verbatim evidence, and a new run can be queued', async ({ page }) => {
  let started = 0;
  await page.addInitScript(() => sessionStorage.setItem('piggybot.ownerAccessToken', `test.${btoa(JSON.stringify({ exp: 4102444800 }))}.test`));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { email: 'test@example.invalid' }, workspace: { name: 'Topics regression' }, role: 'owner', plan: 'creator', subscriptionStatus: 'active' } });
    if (path === '/api/imports') return route.fulfill({ json: [{ id: 'batch-1', label: 'Discord snapshot', sourceType: 'csv', status: 'classified', modelBand: 'eco', itemCount: 3, createdAt: '2026-09-14', tagDistribution: {} }] });
    if (path === '/api/topics') return route.fulfill({ json: { run, topics } });
    if (path === '/api/topics/topic-1/items') return route.fulfill({ json: { topic: topics[0], total: 2, items: [
      { itemId: 'item-1', platform: 'discord', author: 'fan01', text: 'please add TikTok Shop import, we need it', evidence: 'TikTok Shop import', confidence: 0.95, createdAt: '2026-09-14' },
      { itemId: 'item-2', platform: 'discord', author: 'fan02', text: 'TikTok Shop import would save my week', evidence: 'TikTok Shop import', confidence: 0.9, createdAt: '2026-09-14' },
    ] } });
    if (path === '/api/topics/runs') {
      started += 1;
      expect(route.request().method()).toBe('POST');
      expect(route.request().headers().authorization).toMatch(/^Bearer test\./);
      return route.fulfill({ status: 201, json: { ...run, status: 'pending', completedAt: null } });
    }
    if (path.startsWith('/api/billing/')) return route.fulfill({ status: 503, json: { error: 'unused' } });
    return route.fulfill({ json: [] });
  });

  await page.goto('/app');
  await page.getByRole('button', { name: 'Topics', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Topic clustering' })).toBeVisible();
  // 计数来自平台 SQL（×N 徽章），逐主题可审计。
  await expect(page.getByText('TikTok Shop import', { exact: true })).toBeVisible();
  await expect(page.getByText('×2', { exact: true })).toBeVisible();
  await expect(page.getByText('Pricing question', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Audit 2 items' }).click();
  await expect(page.getByText('2 verified mentions')).toBeVisible();
  await expect(page.locator('mark').first()).toHaveText('TikTok Shop import');
  await expect(page.getByText('please add TikTok Shop import, we need it')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'Cluster all items' }).click();
  await expect(page.getByText('Topic run queued — clustering every classified item with verifiable counts.')).toBeVisible();
  expect(started).toBe(1);
});
