import { test, expect } from '@playwright/test';

test('weekly review shows denominators, unknown effects and report navigation; refresh failure clears stale totals', async ({ page }) => {
  let failNext = false;
  const report = { id: 'report-1', title: 'Weekly tasks', template: 'daily_ops', status: 'generated', modelBand: 'eco', itemCount: 500, droppedCitations: 0, createdAt: '2026-09-14', delivery: null, report: { summary: 'Fans want a poll', tasks: [] } };
  const empty = { template: 'content_recap', label: 'Content recap', reports: [], counts: { actions: 0, reviewed: 0, planned: 0, adopted: 0, completed: 0, dismissed: 0, unreviewed: 0 }, effects: { improved: 0, unchanged: 0, worse: 0, unknown: 0 }, knownEffects: 0, adoptionRate: null, completionRate: null, improvementRate: null };
  await page.addInitScript(() => sessionStorage.setItem('piggybot.ownerAccessToken', `test.${btoa(JSON.stringify({ exp: 4102444800 }))}.test`));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { email: 'test@example.invalid' }, workspace: { name: 'Weekly regression' }, role: 'owner', plan: 'creator', subscriptionStatus: 'trialing' } });
    if (path === '/api/insights/weekly-review') {
      expect(route.request().headers().authorization).toMatch(/^Bearer test\./);
      if (failNext) return route.fulfill({ status: 503, json: { error: 'temporary_failure' } });
      return route.fulfill({ json: { start: '2026-09-07T12:00:00.000Z', end: '2026-09-14T12:00:00.000Z', templates: [empty, {
        ...empty, template: 'daily_ops', label: 'Daily ops tasks',
        counts: { actions: 5, reviewed: 4, planned: 1, adopted: 3, completed: 2, dismissed: 0, unreviewed: 1 },
        effects: { improved: 1, unchanged: 0, worse: 0, unknown: 1 }, knownEffects: 1, adoptionRate: 0.6, completionRate: 0.4, improvementRate: 1,
        reports: [{ id: 'report-1', title: 'Weekly tasks', summary: 'Fans want a poll', actions: [{ key: 'tasks:0', title: 'Prepare poll', status: 'completed', effect: 'improved', note: 'More replies observed' }] }],
      }] } });
    }
    if (path === '/api/insights/report-1') return route.fulfill({ json: report });
    if (path.startsWith('/api/billing/')) return route.fulfill({ status: 503, json: { error: 'unused' } });
    if (path === '/api/topics') return route.fulfill({ json: { run: null, topics: [] } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/app');
  await page.getByRole('button', { name: 'Insights', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Weekly follow-up review' });
  await panel.getByRole('button', { name: 'Load weekly review' }).click();
  await expect(panel).toContainText('Adopted: 3/5 (60.0%)');
  await expect(panel).toContainText('Completed: 2/5 (40.0%)');
  await expect(panel).toContainText('Improved: 1/1 (100.0%)');
  await expect(panel).toContainText('Completed, effect unknown: 1');
  await expect(panel).toContainText('Adopted: 0/0 (N/A)');
  await panel.getByText('Weekly tasks', { exact: true }).click();
  await expect(panel).toContainText('More replies observed');
  await panel.getByRole('button', { name: 'Open report and update feedback' }).click();
  await expect(page.getByRole('region', { name: 'Execution feedback' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to insights', exact: true }).click();
  failNext = true;
  await panel.getByRole('button', { name: 'Refresh weekly review' }).click();
  await expect(panel.getByRole('alert')).toContainText('Unable to load weekly review');
  await expect(panel.getByText('Adopted: 3/5 (60.0%)', { exact: false })).toHaveCount(0);
});
