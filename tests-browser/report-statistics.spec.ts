import { test, expect } from '@playwright/test';

test('content recap displays quoted script drafts and truthful historical topic counts', async ({ page }) => {
  const report = { id: 'recap-1', title: 'Content recap regression', template: 'content_recap', status: 'generated', modelBand: 'eco', itemCount: 500, droppedCitations: 0, createdAt: '2026-09-14', delivery: null,
    report: { summary: 'Fans want process videos', topContent: [], successFactors: [], fanThemes: [], nextTopics: ['Sketching', 'Assembly'], draftTitles: [],
      draftScripts: [{ title: 'Build the first prototype', body: 'Start with a sketch.\nShow the assembly.', citations: [{ ref: 'i1', snippet: 'show the process' }] }],
    },
  };
  await page.addInitScript(() => sessionStorage.setItem('piggybot.ownerAccessToken', `test.${btoa(JSON.stringify({ exp: 4102444800 }))}.test`));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { email: 'test@example.invalid' }, workspace: { name: 'Recap regression' }, role: 'owner', plan: 'creator', subscriptionStatus: 'trialing' } });
    if (path === '/api/insights') return route.fulfill({ json: [report] });
    if (path === '/api/insights/recap-1') return route.fulfill({ json: report });
    if (path.startsWith('/api/billing/')) return route.fulfill({ status: 503, json: { error: 'unused' } });
    if (path === '/api/topics') return route.fulfill({ json: { run: null, topics: [] } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/app');
  await page.getByRole('button', { name: 'Insights', exact: true }).click();
  await page.getByRole('button', { name: 'Open report', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Next batch: 2 topic ideas' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Script drafts · review before publishing' })).toBeVisible();
  await expect(page.getByText('Build the first prototype', { exact: true })).toBeVisible();
  await expect(page.getByText('Start with a sketch. Show the assembly.', { exact: true })).toBeVisible();
  await expect(page.getByText(/show the process/)).toBeVisible();
});

test('report shows full totals separately from sampled quotations and supports historical reports', async ({ page }) => {
  let includeDataset = true;
  const report = () => ({ id: 'report-1', title: 'Dataset regression', template: 'review_attribution',
    status: 'generated', modelBand: 'eco', itemCount: 5000, droppedCitations: 0, createdAt: '2026-09-14', delivery: null,
    report: { summary: 'Packaging feedback', issueClusters: [{ theme: 'Broken packaging', severity: 'high', approxCount: 1, affectedSkus: ['SKU-A'], citations: [{ ref: 'i1', snippet: 'broken packaging' }] }], returnReasons: [], expectationMismatches: [], priorityFixes: [], serviceReplyDrafts: [], listingFixSuggestions: [], _reviewRanking: { basis: 'model_severity_then_distinct_cited_sources', candidateIssues: 1, displayedIssues: 1 },
      ...(includeDataset ? { _dataset: { items: 5000, taggedItems: 3000, sampledItems: 32, tagDistribution: { complaint: 3000 }, ratings: { rated: 4000, negative: 3000 }, sentiments: { classified: 4000, unknown: 1000, distribution: { excited: 1000, neutral: 3000 } } } } : {}),
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
  await expect(page.getByText(/Top 1 issues \(up to 5\)/)).toBeVisible();
  await expect(page.getByText(/not a sales-impact or full-dataset frequency ranking/)).toBeVisible();
  await expect(page.getByText('SKU: SKU-A', { exact: true })).toBeVisible();
  await expect(stats).toContainText('5000 source items');
  await expect(stats).toContainText('3000 with intent labels (60.0%)');
  await expect(stats).toContainText('32 sampled for quotations');
  await expect(stats).toContainText('Negative reviews: 3000 / 4000 rated items (75.0%)');
  await expect(stats).toContainText('not emotion percentages');
  const emotions = page.getByRole('region', { name: 'Emotion distribution' });
  await expect(emotions).toContainText('Classified: 4000 / 5000 · Unknown: 1000 (20.0%)');
  await expect(emotions).toContainText('excited: 1000 (20.0%)');
  await expect(emotions).toContainText('unknown is not neutral');
  await page.getByRole('button', { name: 'Back to reports', exact: true }).click();
  includeDataset = false;
  await page.getByRole('button', { name: 'Open report', exact: true }).click();
  await expect(page.getByText('Packaging feedback', { exact: true })).toBeVisible();
  await expect(stats).toHaveCount(0);
});
