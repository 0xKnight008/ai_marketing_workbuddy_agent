import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('admin ledger exports all pages, preserves unknown counts and neutralizes CSV formulas', async ({ page }) => {
  await page.route('**/api/admin/auth/session', route => route.fulfill({ json: { email: 'admin@example.test' } }));
  const row = (id: number) => ({ id, event_id: `event-${id}`, created_at: '2026-10-19T00:00:00.000Z', run_id: 'run-test', operation: '=HYPERLINK("bad")', provider: 'deepseek', requested_model: 'alias', model_name: 'deepseek-flash', response_id: null, prompt_tokens: 10, completion_tokens: null, reasoning_tokens: null, cached_input_tokens: null, finish_reason: 'stop' });
  await page.route('**/api/admin/token-usage?**', route => {
    const before = new URL(route.request().url()).searchParams.get('before');
    return route.fulfill({ json: before ? [row(1)] : Array.from({ length: 100 }, (_, i) => row(101 - i)) });
  });
  await page.goto('/app/admin');
  await page.getByRole('tab', { name: 'Token usage', exact: true }).click();
  await page.getByRole('button', { name: 'Load / first page' }).click();
  await expect(page.getByRole('region', { name: 'Token usage ledger' })).toContainText('100 records on this page');
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('region', { name: 'Token usage ledger' })).toContainText('1 records on this page');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download matching CSV' }).click();
  const download = await downloadPromise;
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv.split('\r\n').filter(Boolean)).toHaveLength(102);
  expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
  expect(csv).toContain('"10","","",""');
  await expect(page.getByRole('region', { name: 'Token usage ledger' })).toContainText('Exported 101 records');
});

test('ledger export failure never downloads a partial CSV', async ({ page }) => {
  await page.route('**/api/admin/auth/session', route => route.fulfill({ json: { email: 'admin@example.test' } }));
  await page.route('**/api/admin/token-usage?**', route => route.fulfill({ status: 502, json: { error: 'token_usage_unavailable' } }));
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.goto('/app/admin');
  await page.getByRole('tab', { name: 'Token usage', exact: true }).click();
  await page.getByRole('button', { name: 'Download matching CSV' }).click();
  await expect(page.getByRole('region', { name: 'Token usage ledger' })).toContainText('Could not load token usage');
  expect(downloads).toBe(0);
});

test('admin offers only Chinese and English and retains raw ledger fields',async({page})=>{
 await page.route('**/api/admin/auth/session',route=>route.fulfill({json:{email:'admin@example.test'}}));await page.route('**/api/admin/token-usage?**',route=>route.fulfill({json:[{id:1,event_id:'e-1',created_at:'2026-10-19T00:00:00Z',run_id:'r-1',operation:'classify',provider:'deepseek',requested_model:'standard',model_name:'model',response_id:'response-1',prompt_tokens:10,completion_tokens:5,total_tokens:15,reasoning_tokens:null,cached_input_tokens:null,finish_reason:'stop'}]}));await page.goto('/app/admin');const language=page.locator('.admin-brand-bar select');await expect(language.locator('option')).toHaveCount(2);await language.selectOption('zh');await expect(page.locator('html')).toHaveAttribute('lang','zh');await page.getByRole('region').getByRole('button').first().click();await expect(page.getByRole('table')).toContainText('classify');await page.getByRole('table').locator('summary').click();await expect(page.getByRole('table')).toContainText('response_id');await expect(page.getByRole('table')).toContainText('response-1');await language.selectOption('en');await expect(page.getByRole('region',{name:'Token usage ledger'})).toContainText('classify');
});

test('mobile admin navigation is keyboard usable and does not overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.route('**/api/admin/auth/session',route=>route.fulfill({json:{email:'admin@example.test'}}));await page.goto('/app/admin');const menu=page.getByRole('button',{name:'Navigation',exact:true});await menu.click();await expect(page.getByRole('tab',{name:'Token usage',exact:true})).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(page.getByRole('tab',{name:'Referral ledger',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(menu).toBeFocused();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});

for(const locale of ['en','zh'] as const)test(`${locale}: cost reconciliation retains token ledger and exports scoped receipts`,async({page})=>{
 await page.route('**/api/admin/auth/session',r=>r.fulfill({json:{email:'admin@example.test'}}));
 await page.route('**/api/admin/ai-costs?**',r=>{expect(new URL(r.request().url()).searchParams.get('workspaceId')).toBe('44444444-4444-4444-8444-444444444444');return r.fulfill({json:[{id:'op-1',subjectId:'task-1',kind:'task.turn',band:'flagship',mode:'cost-v1',state:'settled',maxCredits:30,heldCredits:0,settledCredits:12,releasedCredits:18,supplierCostNanos:'10000000',unknownReceipts:'0',policyVersion:'cost-v1',rateVersion:'fixture-v1',actualModels:['=unsafe-model'],createdAt:'2026-10-24T00:00:00Z'}]})});
 await page.goto(`/app/admin?adminLocale=${locale}`);await expect(page.getByRole('region',{name:locale==='en'?'Token usage ledger':'Token 用量账本'})).toBeVisible();
 await page.getByLabel(locale==='en'?'Workspace UUID':'工作区 UUID').fill('44444444-4444-4444-8444-444444444444');await page.getByRole('button',{name:locale==='en'?'Load costs':'读取成本',exact:true}).click();
 await expect(page.getByRole('table',{name:locale==='en'?'AI cost reconciliation':'AI 成本对账'})).toContainText('10000000');const download=page.waitForEvent('download');await page.getByRole('button',{name:locale==='en'?'Download latest 100 costs CSV':'导出最近 100 条成本 CSV',exact:true}).click();
 const csv=await readFile((await (await download).path())!,'utf8');expect(csv).toContain('"\'=unsafe-model"');expect(csv).toContain('"12","18"');
});
