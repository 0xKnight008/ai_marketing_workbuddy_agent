import { test, expect } from '@playwright/test';

test('referral ledger displays exact balances and paginates referee records', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('piggybot.ownerAccessToken', `test.${btoa(JSON.stringify({ exp: 4102444800 }))}.test`));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { email: 'referrer@example.invalid' }, workspace: { id: 'workspace-test', name: 'Referral regression' }, role: 'owner', plan: 'creator', subscriptionStatus: 'trialing' } });
    if (url.pathname === '/api/referral/summary') {
      const offset = Number(url.searchParams.get('offset'));
      return route.fulfill({ json: { attributed: '51', currencies: [{ currency: 'usd', pending: '10000', available: '200000', credited: '300000', reversalpending: '100000', reversed: '0' }],
        entries: Array.from({ length: offset ? 1 : 50 }, (_, i) => ({ attributionId: `attr-${offset + i}`, referredWorkspaceId: `referee-${offset + i}`, ledgerId: `ledger-${offset + i}`, invoiceId: `invoice-${offset + i}`, amountMicros: '10000', currency: 'usd', status: 'pending' })) } });
    }
    if (url.pathname.startsWith('/api/billing/')) return route.fulfill({ status: 503, json: { error: 'unused' } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/app#settings');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh ledger' }).click();
  await expect(page.getByText('Attributed workspaces: 51')).toBeVisible();
  await expect(page.getByText(/Total issued: 0.30/)).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'referee-50', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'referee-0', exact: true })).toBeVisible();
});
