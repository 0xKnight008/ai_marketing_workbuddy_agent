import { test, expect } from '@playwright/test';

test('report shows full totals separately from sampled quotations and supports historical reports', async ({ page }) => {
  let includeDataset = true;
  const report = () => ({ id: 'report-1', title: 'Dataset regression', template: 'review_attribution',
    status: 'generated', modelBand: 'eco', itemCount: 5000, droppedCitations: 0, createdAt: '2026-09-14', delivery: null,
    report: { summary: 'Packaging feedback', issueClusters: [], returnReasons: [], expectationMismatches: [], priorityFixes: [], serviceReplyDrafts: [], listingFixSuggestions: [],
      ...(includeDataset ? { _dataset: { items: 5000, taggedItems: 3000, sampledItems: 32, tagDistribution: { complaint: 3000 }, ratings: { rated: 4000, negative: 3000 } } } : {}),
    },
  });
  await page.addInitScript(() => sessionStorage.setItem('piggybot.ownerAccessToken', `test.${btoa(JSON.stringify({ exp: 4102444800 }))}.test`));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { email: 'test@example.invalid' }, workspace: { name: 'Statistics regression' }, role: 'owner', plan: 'creator', subscriptionStatus: 'trialing' } });
    if (path === '/api/insights') return route.fulfill({ json: [report()] });
    if (path === '/api/insights/report-1') return route.fulfill({ json: report() });
    if (path.startsWith('/api/billing/')) return route.fulfill({ status: 503, json: { error: 'not used by this test' } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/app');
  await page.getByRole('button', { name: 'Insights', exact: true }).click();
  await page.getByRole('button', { name: 'Open report', exact: true }).click();
  const stats = page.getByRole('region', { name: 'Full dataset statistics' });
  await expect(stats).toContainText('5000 source items');
  await expect(stats).toContainText('3000 with intent labels (60.0%)');
  await expect(stats).toContainText('32 sampled for quotations');
  await expect(stats).toContainText('Negative reviews: 3000 / 4000 rated items (75.0%)');
  await expect(stats).toContainText('not emotion percentages');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  includeDataset = false;
  await page.getByRole('button', { name: 'Open report', exact: true }).click();
  await expect(page.getByText('Packaging feedback', { exact: true })).toBeVisible();
  await expect(stats).toHaveCount(0);
});
