import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page, failSave = false) {
  let started = false;
  let checked = 0;
  let polled = false;
  const account = { id: 'account-1', displayName: 'Test LinkedIn', platform: 'linkedin', status: 'connected', capabilities: ['publish'] };
  const run = { id: 'run-1', workflowId: 'pipeline-1', status: 'queued', createdAt: '2026-10-21' };
  await page.addInitScript(() => sessionStorage.setItem('piggybot.ownerAccessToken', `test.${btoa(JSON.stringify({ exp: 4102444800 }))}.test`));
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { email: 'test@example.invalid', passwordSet: true }, workspace: { name: 'Test' }, role: 'owner', plan: 'growth', subscriptionStatus: 'active' } });
    if (path === '/api/billing/usage') return route.fulfill({ json: { status: 'normal', subscriptionStatus: 'active', aiCreditsAvailable: 100, taskQuota: 1000, taskUsed: 0, plan: 'growth' } });
    if (path === '/api/pipeline-templates') return route.fulfill({ json: [{ id: 'repurpose', name: 'Repurpose and publish', description: 'Prepare a product launch announcement', steps: ['Brief', 'AI drafts', 'Review', 'Publish'], available: true }] });
    if (path === '/api/zernio/accounts') return route.fulfill({ json: [account] });
    if (path === '/api/pipelines' && request.method() === 'POST') {
      if (failSave) return route.fulfill({ status: 500, json: { error: 'The pipeline draft could not be saved.' } });
      const payload = request.postDataJSON();
      return route.fulfill({ json: { id: 'pipeline-1', status: 'draft', version: 1, name: payload.name, definition: { ...payload.configuration, source: payload.source } } });
    }
    if (path.endsWith('/test')) { checked++; return route.fulfill({ json: { ready: true, checks: [] } }); }
    if (path.endsWith('/activate')) { started = true; return route.fulfill({ json: { id: 'pipeline-1', name: 'Launch', status: 'published', run } }); }
    if (path === '/api/runs/run-1') { polled = true; return route.fulfill({ json: { ...run, status: 'waiting_approval' } }); }
    if (path === '/api/approval-requests') return route.fulfill({ json: polled ? [{ id: 'approval-1', runId: 'run-1', requestedAt: '2026-10-21', requestedAction: { summary: 'Publish launch draft', actions: [{ content: 'A launch draft to approve' }] } }] : [] });
    if (path === '/api/topics') return route.fulfill({ json: { run: null, topics: [] } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/app#pipelines');
  await page.locator('[data-nav=pipelines]').click();
  await page.getByRole('button', { name: /Repurpose and publish/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Review pipeline', exact: true }).click();
  await page.getByRole('button', { name: 'Save and check setup', exact: true }).click();
  return { started: () => started, checked: () => checked };
}

test('review saves and checks setup, explicit start reaches pending approval without refresh', async ({ page }) => {
  const state = await setup(page);
  await expect.poll(state.checked).toBe(1);
  expect(state.started()).toBe(false);
  await page.getByRole('button', { name: 'Start run (approval required)', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(state.started).toBe(true);
  await page.locator('[data-nav=review]').click();
  await expect(page.getByRole('heading', { name: 'Publish launch draft', exact: true })).toBeVisible({ timeout: 15000 });
});

test('save errors appear inside review and permit retry', async ({ page }) => {
  const state = await setup(page, true);
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('The pipeline draft could not be saved.');
  await expect(page.getByRole('button', { name: 'Save and check setup', exact: true })).toBeEnabled();
  expect(state.started()).toBe(false);
  expect(state.checked()).toBe(0);
});
