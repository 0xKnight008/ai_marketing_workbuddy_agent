import { test, expect } from '@playwright/test';

// Browser regression uses stubbed API responses, never production accounts.
test('first CSV upload submits filename immediately, preserves custom labels and rejects oversized files', async ({ page }) => {
  const submissions: Array<{ label: string; content: string }> = [];
  await page.addInitScript(() => sessionStorage.setItem('piggybot.ownerAccessToken', `test.${btoa(JSON.stringify({ exp: 4102444800 }))}.test`));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { email: 'test@example.invalid' }, workspace: { name: 'Import regression' }, role: 'owner', plan: 'creator', subscriptionStatus: 'trialing' } });
    if (path === '/api/imports' && route.request().method() === 'POST') {
      submissions.push(route.request().postDataJSON());
      return route.fulfill({ json: { id: 'test-batch', status: 'pending' } });
    }
    if (path.startsWith('/api/billing/')) return route.fulfill({ status: 503, json: { error: 'not used by this import regression' } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/app');
  await page.getByRole('button', { name: 'Imports', exact: true }).click();
  const file = page.locator('input[type=file]');
  await file.setInputFiles({ name: 'first.csv', mimeType: 'text/csv', buffer: Buffer.from('text\nhello') });
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0]).toMatchObject({ label: 'first', content: 'text\nhello' });
  await expect(page.getByText(/Import queued/)).toBeVisible();
  await page.getByPlaceholder('October comment export').fill('Custom label');
  await file.setInputFiles({ name: 'second.csv', mimeType: 'text/csv', buffer: Buffer.from('text\nsecond') });
  await expect.poll(() => submissions.length).toBe(2);
  expect(submissions[1].label).toBe('Custom label');
  await expect(page.getByText(/Import queued/)).toBeVisible();
  await file.setInputFiles({ name: 'large.csv', mimeType: 'text/csv', buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 'x') });
  await expect(page.getByText(/CSV files are limited/)).toBeVisible();
  expect(submissions).toHaveLength(2);
});
