import { test, expect } from '@playwright/test';

test('scheduled delivery: rule save is standing approval; weekly digest needs a click; urgent alerts close the loop', async ({ page }) => {
  const rules: unknown[] = [];
  const events = [
    { id: 'event-weekly', kind: 'weekly_report', status: 'pending_approval', channel: 'email', targetLabel: 'owner@example.invalid', subject: '[Piggybot] 爆款内容复盘 · 周报 2026-09-15', error: null, reportId: 'report-1', createdAt: '2026-09-15T08:05:00.000Z', sentAt: null, actedAt: null },
    { id: 'event-urgent', kind: 'urgent_risk', status: 'sent', channel: 'email', targetLabel: 'owner@example.invalid', subject: '[Piggybot] Urgent risk in "社区周报"', error: null, reportId: 'report-2', createdAt: '2026-09-16T12:00:00.000Z', sentAt: '2026-09-16T12:00:05.000Z', actedAt: null },
  ];
  await page.addInitScript(() => sessionStorage.setItem('piggybot.ownerAccessToken', `test.${btoa(JSON.stringify({ exp: 4102444800 }))}.test`));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { email: 'test@example.invalid' }, workspace: { name: 'Notifications regression' }, role: 'owner', plan: 'creator', subscriptionStatus: 'trialing' } });
    if (path === '/api/notifications/rules' && method === 'GET') return route.fulfill({ json: { rules, weeklyTemplates: [{ id: 'content_recap', label: 'Content recap' }] } });
    if (path === '/api/notifications/rules/morning_push' && method === 'PUT') {
      const body = route.request().postDataJSON() as { channel: string };
      rules.push({ id: 'rule-1', kind: 'morning_push', channel: body.channel, email: null, connectedAccountId: null, weeklyTemplate: null, weeklyDeliveryMode: null, updatedAt: '2026-09-17T00:00:00.000Z' });
      return route.fulfill({ json: { id: 'rule-1', kind: 'morning_push', updatedAt: '2026-09-17T00:00:00.000Z' } });
    }
    if (path === '/api/notifications/events' && method === 'GET') return route.fulfill({ json: { events } });
    if (path === '/api/notifications/events/event-weekly/approve' && method === 'POST') {
      events[0]!.status = 'queued';
      return route.fulfill({ json: { id: 'event-weekly', status: 'queued' } });
    }
    if (path === '/api/notifications/events/event-urgent/act' && method === 'POST') {
      const body = route.request().postDataJSON() as { action: string };
      events[1]!.status = body.action === 'acknowledge' ? 'acknowledged' : 'resolved';
      return route.fulfill({ json: { id: 'event-urgent', status: events[1]!.status } });
    }
    if (path.startsWith('/api/billing/')) return route.fulfill({ status: 503, json: { error: 'unused' } });
    if (path === '/api/topics') return route.fulfill({ json: { run: null, topics: [] } });
    return route.fulfill({ json: [] });
  });

  await page.goto('/app');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Scheduled delivery' });
  await panel.getByRole('button', { name: 'Load scheduled delivery' }).click();

  // Four flows with honest schedules and the standing-approval disclaimer.
  await expect(panel).toContainText('Morning push');
  await expect(panel).toContainText('every day at 20:00 UTC');
  await expect(panel).toContainText('every Monday 08:00 UTC');
  await expect(panel).toContainText('immediately when a report flags a high-severity risk');

  // Enabling a flow saves the rule (standing approval) and flips the badge to on.
  const morning = panel.locator('article', { hasText: 'Morning push' }).first();
  await morning.getByRole('button', { name: 'Enable' }).click();
  await morning.getByRole('button', { name: 'Save rule' }).click();
  await expect(morning).toContainText('on · email');

  // Weekly approval delivery: a human click releases the frozen digest.
  await expect(panel).toContainText('pending_approval');
  await panel.getByRole('button', { name: 'Approve delivery' }).click();
  await expect(panel).toContainText('queued');

  // Urgent risk loop: sent → acknowledged → resolved.
  await panel.getByRole('button', { name: 'Acknowledge' }).click();
  await expect(panel).toContainText('acknowledged');
  await panel.getByRole('button', { name: 'Resolve' }).click();
  await expect(panel).toContainText('resolved');
});
