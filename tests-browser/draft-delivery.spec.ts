import { test, expect } from '@playwright/test';

test('selects a full presale draft and displays exact text in the approval queue', async ({ page }) => {
  const poll = 'Which design should we make?\nA: cat badge\nB: fox standee\nPlease vote before Friday.';
  const report = { id: 'report-1', title: 'Draft review', template: 'product_opportunities', status: 'generated', modelBand: 'eco', itemCount: 500, droppedCitations: 0, createdAt: '2026-09-14', delivery: null, report: { summary: 'Fans want merchandise', opportunities: [], presalePollDraft: poll } };
  let submitted: Record<string, unknown> | null = null;
  await page.addInitScript(() => sessionStorage.setItem('piggybot.ownerAccessToken', `test.${btoa(JSON.stringify({ exp: 4102444800 }))}.test`));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { email: 'test@example.invalid' }, workspace: { name: 'Draft regression' }, role: 'owner', plan: 'creator', subscriptionStatus: 'trialing' } });
    if (path === '/api/insights') return route.fulfill({ json: [report] });
    if (path === '/api/insights/report-1') return route.fulfill({ json: report });
    if (path === '/api/insights/report-1/deliver') {
      submitted = route.request().postDataJSON();
      return route.fulfill({ json: { ...report, delivery: { status: 'awaiting_approval', channel: 'email', targetLabel: 'owner@example.invalid' } } });
    }
    if (path === '/api/approval-requests') return route.fulfill({ json: submitted ? [{ id: 'approval-1', runId: null, requestedAt: '2026-09-14', requestedAction: { summary: 'Send selected draft', parameters: { content: poll, subject: '[Piggybot] Draft review' } } }] : [] });
    if (path.startsWith('/api/billing/')) return route.fulfill({ status: 503, json: { error: 'unused' } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/app');
  await page.getByRole('button', { name: 'Insights', exact: true }).click();
  await page.getByRole('button', { name: 'Open report', exact: true }).click();
  await page.getByRole('button', { name: 'Send report…', exact: true }).click();
  await page.getByLabel('Content to send', { exact: true }).selectOption('presalePollDraft');
  await page.getByRole('button', { name: 'Request approval', exact: true }).click();
  await expect.poll(() => submitted).toEqual({ channel: 'email', draftKey: 'presalePollDraft' });
  await expect(page.getByText('Delivery queued — approve it in the Activity tab to send.')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByText('Exact message to be sent:', { exact: true })).toBeVisible();
  await expect(page.locator('pre').filter({ hasText: 'Please vote before Friday.' })).toHaveText(poll);
});
