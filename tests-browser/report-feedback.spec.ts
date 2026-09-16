import { test, expect } from '@playwright/test';

test('manual execution feedback saves, persists on reopen, and keeps edits after failure', async ({ page }) => {
  const report = { id: 'report-1', title: 'Feedback regression', template: 'daily_ops', status: 'generated', modelBand: 'eco', itemCount: 500, droppedCitations: 0, createdAt: '2026-09-14', delivery: null,
    report: { summary: 'Follow up audience feedback', tasks: [] } };
  let feedback: Record<string, unknown> | null = null;
  let failNext = false;
  const saves: Record<string, unknown>[] = [];
  await page.addInitScript(() => sessionStorage.setItem('piggybot.ownerAccessToken', `test.${btoa(JSON.stringify({ exp: 4102444800 }))}.test`));
  await page.route('**/api/**', async route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { email: 'test@example.invalid' }, workspace: { name: 'Feedback regression' }, role: 'owner', plan: 'creator', subscriptionStatus: 'trialing' } });
    if (path === '/api/insights') return route.fulfill({ json: [report] });
    if (path === '/api/insights/report-1') return route.fulfill({ json: report });
    if (path === '/api/insights/report-1/actions') return route.fulfill({ json: { canEdit: true, actions: [{ key: 'tasks:0', title: 'Reply to fans', feedback }] } });
    if (path === '/api/insights/report-1/actions/tasks:0') {
      expect(route.request().method()).toBe('PUT');
      expect(route.request().headers().authorization).toMatch(/^Bearer test\./);
      if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { error: 'temporary_failure' } }); }
      feedback = route.request().postDataJSON(); saves.push(feedback!);
      return route.fulfill({ json: feedback });
    }
    if (path.startsWith('/api/billing/')) return route.fulfill({ status: 503, json: { error: 'unused' } });
    if (path === '/api/topics') return route.fulfill({ json: { run: null, topics: [] } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/app');
  await page.getByRole('button', { name: 'Insights', exact: true }).click();
  await page.getByRole('button', { name: 'Open report', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Execution feedback' });
  await expect(panel).toContainText('Saving does not execute, publish or approve anything');
  await expect(panel.getByLabel('Observed effect: Reply to fans')).toBeDisabled();
  await panel.getByLabel('Action status: Reply to fans').selectOption('completed');
  await panel.getByLabel('Observed effect: Reply to fans').selectOption('improved');
  await panel.getByLabel('Outcome notes: Reply to fans').fill('Five fans replied');
  await panel.getByRole('button', { name: 'Save feedback: Reply to fans' }).click();
  await expect(panel).toContainText('Feedback saved');
  expect(saves[0]).toEqual({ status: 'completed', effect: 'improved', note: 'Five fans replied' });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Open report', exact: true }).click();
  await expect(panel.getByLabel('Outcome notes: Reply to fans')).toHaveValue('Five fans replied');
  await panel.getByLabel('Outcome notes: Reply to fans').fill('Updated observation');
  failNext = true;
  await panel.getByRole('button', { name: 'Save feedback: Reply to fans' }).click();
  await expect(panel).toContainText('Your edits are retained');
  await expect(panel.getByLabel('Outcome notes: Reply to fans')).toHaveValue('Updated observation');
  expect(saves).toHaveLength(1);
});
