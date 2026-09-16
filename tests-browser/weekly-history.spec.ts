import { test, expect } from '@playwright/test';

test('weekly history attributes execution by feedback time, seals immutably, and compares consecutive weeks', async ({ page }) => {
  let sealed = false;
  const totals = (events: number, completed: number, improved: number) => ({
    events, planned: 0, adopted: completed, completed, dismissed: 0,
    effects: { improved, unchanged: 0, worse: 0, unknown: completed - improved }, knownEffects: improved,
    adoptionRate: events ? completed / events : null, completionRate: events ? completed / events : null, improvementRate: improved ? 1 : null,
  });
  const completedAction = {
    key: 'tasks:0', title: 'Prepare poll', status: 'completed', effect: 'improved', note: 'More replies observed',
    updatedAt: '2026-09-09T10:00:00.000Z', reportId: 'report-old', reportTitle: 'August tasks', template: 'daily_ops',
  };
  const execution = {
    weekStart: '2026-09-07T00:00:00.000Z', weekEnd: '2026-09-14T00:00:00.000Z',
    totals: totals(2, 2, 1), completedActions: [completedAction],
    templates: [{ template: 'daily_ops', label: 'Daily ops tasks', counts: { events: 2, planned: 0, adopted: 2, completed: 2, dismissed: 0 }, knownEffects: 1, adoptionRate: 1, completionRate: 1, improvementRate: 1, reports: [{ id: 'report-old', title: 'August tasks', generatedAt: '2026-08-10T00:00:00.000Z', actions: [completedAction] }] }],
  };
  const sealedWeek = {
    weekStart: '2026-08-31', weekEnd: '2026-09-07', sealedAt: '2026-09-07T01:00:00.000Z',
    totals: totals(3, 1, 1),
    comparison: { events: -1, completed: 1, adoptionRate: 0.5, completionRate: 0.5, improvementRate: null },
  };
  const report = { id: 'report-old', title: 'August tasks', template: 'daily_ops', status: 'generated', modelBand: 'eco', itemCount: 500, droppedCitations: 0, createdAt: '2026-08-10', delivery: null, report: { summary: 'Old findings', tasks: [] } };

  await page.addInitScript(() => sessionStorage.setItem('piggybot.ownerAccessToken', `test.${btoa(JSON.stringify({ exp: 4102444800 }))}.test`));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { email: 'test@example.invalid' }, workspace: { name: 'History regression' }, role: 'owner', plan: 'creator', subscriptionStatus: 'trialing' } });
    if (path === '/api/insights/weekly-history') return route.fulfill({ json: {
      basis: 'feedback_updated_in_window',
      current: { ...execution, sealed, comparison: { events: -1, completed: 1, adoptionRate: 0.5, completionRate: 0.5, improvementRate: null } },
      weeks: [sealedWeek],
    } });
    if (path === '/api/insights/weekly-history/snapshots' && route.request().method() === 'POST') {
      if (sealed) return route.fulfill({ status: 409, json: { error: 'weekly_review_snapshot_exists' } });
      sealed = true;
      return route.fulfill({ status: 201, json: { weekStart: execution.weekStart, weekEnd: execution.weekEnd, sealedAt: '2026-09-10T08:00:00.000Z', totals: execution.totals } });
    }
    if (path === '/api/insights/weekly-history/2026-08-31') return route.fulfill({ json: { ...execution, weekStart: '2026-08-31', weekEnd: '2026-09-07', sealedAt: sealedWeek.sealedAt, totals: sealedWeek.totals } });
    if (path === '/api/insights/report-old') return route.fulfill({ json: report });
    if (path.startsWith('/api/billing/')) return route.fulfill({ status: 503, json: { error: 'unused' } });
    if (path === '/api/topics') return route.fulfill({ json: { run: null, topics: [] } });
    return route.fulfill({ json: [] });
  });

  await page.goto('/app');
  await page.getByRole('button', { name: 'Insights', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Weekly execution history' });
  await panel.getByRole('button', { name: 'Load weekly history' }).click();

  // Execution-time attribution: an action from an August report completed this week counts here.
  await expect(panel).toContainText('This week · 2026-09-07 → 2026-09-14');
  await expect(panel).toContainText('Adopted: 2/2 (100.0%) · Completed: 2/2 (100.0%)');
  await expect(panel).toContainText('vs previous week — decisions: -1 · completed: +1 · adoption: +50.0 pp');
  await panel.getByText('Completed this week (1)', { exact: true }).click();
  await expect(panel).toContainText('From report “August tasks” · completed 2026-09-09');

  // Sealing freezes the week; the button disappears once sealed and a notice confirms immutability.
  await panel.getByRole('button', { name: 'Seal this week' }).click();
  await expect(panel.getByRole('status')).toContainText('Week sealed. This snapshot is now immutable');
  await expect(panel.getByRole('button', { name: 'Seal this week' })).toHaveCount(0);
  await expect(panel).toContainText('sealed', { exact: false });

  // Sealed weeks are comparable and their frozen detail is auditable.
  await expect(panel).toContainText('2026-08-31 → 2026-09-07');
  await panel.getByRole('button', { name: 'Show detail' }).click();
  await expect(panel).toContainText('Daily ops tasks: 2 decisions · 2 completed · improved 100.0%');
  await expect(panel).toContainText('Completed that week (1)');
  await panel.getByRole('button', { name: 'Open report' }).first().click();
  await expect(page.getByRole('region', { name: 'Execution feedback' })).toBeVisible();
});
