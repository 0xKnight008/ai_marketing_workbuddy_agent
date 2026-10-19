import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('admin ledger exports all pages, preserves unknown counts and neutralizes CSV formulas', async ({ page }) => {
  await page.route('**/api/admin/auth/session', route => route.fulfill({ json: { email: 'admin@example.test' } }));
  const row = (id: number) => ({ id, event_id: `event-${id}`, created_at: '2026-10-19T00:00:00.000Z', run_id: 'run-test', operation: '=HYPERLINK("bad")', provider: 'deepseek', requested_model: 'alias', model_name: 'deepseek-flash', response_id: null, prompt_tokens: 10, completion_tokens: null, reasoning_tokens: null, cached_input_tokens: null, finish_reason: 'stop' });
  await page.route('**/api/admin/token-usage?**', route => {
    const before = new URL(route.request().url()).searchParams.get('before');
    return route.fulfill({ json: before ? [row(1)] : Array.from({ length: 100 }, (_, i) => row(101 - i)) });
  });
  await page.goto('/app/admin');
  await page.getByRole('tab', { name: 'Token usage', exact: true }).click();
  await page.getByRole('button', { name: 'Load / first page' }).click();
  await expect(page.getByRole('region', { name: 'Token usage ledger' })).toContainText('100 records on this page');
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('region', { name: 'Token usage ledger' })).toContainText('1 records on this page');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download matching CSV' }).click();
  const download = await downloadPromise;
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv.split('\r\n').filter(Boolean)).toHaveLength(102);
  expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
  expect(csv).toContain('"10","","",""');
  await expect(page.getByRole('region', { name: 'Token usage ledger' })).toContainText('Exported 101 records');
});

test('ledger export failure never downloads a partial CSV', async ({ page }) => {
  await page.route('**/api/admin/auth/session', route => route.fulfill({ json: { email: 'admin@example.test' } }));
  await page.route('**/api/admin/token-usage?**', route => route.fulfill({ status: 502, json: { error: 'token_usage_unavailable' } }));
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.goto('/app/admin');
  await page.getByRole('tab', { name: 'Token usage', exact: true }).click();
  await page.getByRole('button', { name: 'Download matching CSV' }).click();
  await expect(page.getByRole('region', { name: 'Token usage ledger' })).toContainText('Could not load token usage');
  expect(downloads).toBe(0);
});
