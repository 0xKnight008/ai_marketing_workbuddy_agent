import { test, expect } from '@playwright/test';

// Browser regression uses stubbed API responses, never production accounts.
test('CSV preview requires confirmation, preserves custom labels and rejects oversized files', async ({ page }) => {
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
    if (path === '/api/topics') return route.fulfill({ json: { run: null, topics: [] } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/app');
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  const file = page.locator('input[type=file]');
  await file.setInputFiles({ name: 'first.csv', mimeType: 'text/csv', buffer: Buffer.from('text\nhello') });
  expect(submissions).toHaveLength(0);
  await page.getByLabel('Batch label',{exact:true}).fill('first');
  await page.getByRole('button',{name:'Preview CSV',exact:true}).click();
  await page.getByRole('button',{name:'Confirm import',exact:true}).click();
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0]).toMatchObject({ label: 'first', content: 'text\nhello' });
  await expect(page.getByText(/Import queued/)).toBeVisible();
  await page.getByPlaceholder('October comment export').fill('Custom label');
  await file.setInputFiles({ name: 'second.csv', mimeType: 'text/csv', buffer: Buffer.from('text\nsecond') });
  await page.getByRole('button',{name:'Preview CSV',exact:true}).click();
  await page.getByRole('button',{name:'Confirm import',exact:true}).click();
  await expect.poll(() => submissions.length).toBe(2);
  expect(submissions[1].label).toBe('Custom label');
  await expect(page.getByText(/Import queued/)).toBeVisible();
  await file.setInputFiles({ name: 'large.csv', mimeType: 'text/csv', buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 'x') });
  await page.getByLabel('Batch label',{exact:true}).fill('Large file');
  await page.getByRole('button',{name:'Preview CSV',exact:true}).click();
  await expect(page.getByText('Use a file under 2 MiB.')).toBeVisible();
  expect(submissions).toHaveLength(2);
  await page.getByPlaceholder('October comment export').fill('Community snapshot');
  await page.getByLabel('Discord channel ID').fill('123456789012345678');
  await page.getByRole('button', { name: 'Import Discord messages', exact: true }).click();
  await expect.poll(() => submissions.length).toBe(3);
  expect(submissions[2]).toMatchObject({ label: 'Community snapshot', sourceType: 'discord', channelId: '123456789012345678' });
  expect(submissions[2]).not.toHaveProperty('content');
  await expect(page.getByText(/Import queued/)).toBeVisible();
  await page.route('**/api/imports', async route => route.request().method() === 'POST'
    ? route.fulfill({ status: 409, json: { error: 'discord_import_no_new_messages' } }) : route.fulfill({ json: [] }));
  await page.getByPlaceholder('October comment export').fill('Repeat snapshot');
  await page.getByRole('button', { name: 'Import Discord messages', exact: true }).click();
  await expect(page.getByText(/No new Discord messages in the latest/)).toBeVisible();
  await expect(page.getByPlaceholder('October comment export')).toHaveValue('Repeat snapshot');
});
