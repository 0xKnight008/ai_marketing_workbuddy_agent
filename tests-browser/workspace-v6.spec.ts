import { test, expect, type Page } from '@playwright/test';
import axe from 'axe-core';
const original='¿Podrías hacer un tutorial paso a paso?';
const report={id:'report-1',batchIds:['batch-1'],title:'Audience requests',template:'community_digest',status:'generated',createdAt:'2026-09-18T10:00:00Z',modelBand:'eco',itemCount:2,droppedCitations:0,delivery:null,report:{_language:'es',summary:'Requests for clearer tutorials.',hotTopics:[{topic:'Step-by-step',citations:[{ref:'i1',snippet:original}]}],unresolvedQuestions:[],highValueMembers:[],conflictRisks:[],activityIdeas:[],announcementDraft:original}};
async function fixture(page:Page, options: { paused?: boolean; initialPath?: string } = {}){
 page.on('pageerror',error=>{throw error;});
 let approvals=[{id:'approval-1',requestedAt:'2026-09-18T10:00:00Z',requestedAction:{summary:'Send saved draft',parameters:{content:original,subject:'[Piggybot] Audience requests',targetLabel:'review@example.invalid',channel:'email'}}}];
 const mutations:Array<{path:string;body:unknown}>=[];
 await page.addInitScript(()=>sessionStorage.setItem('piggybot.ownerAccessToken',`test.${btoa(JSON.stringify({exp:4102444800}))}.test`));
 await page.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;
 if(path==='/api/billing/ai-quote')return route.fulfill({json:{mode:'legacy'}});
 if(req.method()!=='GET')mutations.push({path,body:req.postDataJSON()});
 if(path==='/api/auth/me')return route.fulfill({json:{user:{email:'test@example.invalid',displayName:'Marco',passwordSet:true},workspace:{name:'Studio North'},role:'owner',plan:'growth',subscriptionStatus:'active'}});
 if(path==='/api/approval-requests')return route.fulfill({json:approvals});
 if(path.startsWith('/api/approval-requests/')){approvals=[];return route.fulfill({json:{status:'approved'}});}
 if(path==='/api/billing/dashboard')return route.fulfill({json:{usage:{status:'active',taskUsed:12,taskQuota:100,aiCreditsUsed:2,aiCreditsAvailable:100,plan:'growth',subscriptionStatus:'active'},subscription:null,syncError:false,creditBalance:0,refundDebt:0,includedCredits:100,canManage:true,canUpgrade:true,canTopup:true,topupUnavailableReason:null,topups:[]}});
 if(path==='/api/billing/usage')return route.fulfill({json:{status:options.paused?'paused':'active',taskUsed:12,taskQuota:100,aiCreditsUsed:options.paused?100:2,aiCreditsAvailable:options.paused?0:100,plan:'growth',subscriptionStatus:'active'}});
 if(path==='/api/insights')return route.fulfill({json:req.method()==='POST'?{id:'report-new',status:'pending'}:[report]});
 if(path==='/api/insights/report-1')return route.fulfill({json:report});
 if(path.endsWith('/review'))return route.fulfill({json:{review:null,canEdit:true}});
 if(path.endsWith('/actions'))return route.fulfill({json:{actions:[],canEdit:true}});
 if(path==='/api/imports')return route.fulfill({json:req.method()==='POST'?{id:'batch-new',status:'pending'}:[{id:'batch-1',label:'Feedback',sourceType:'paste',status:'classified',itemCount:2,createdAt:'2026-09-18',modelBand:'eco',tagDistribution:{}}]});
 if(path==='/api/topics')return route.fulfill({json:{run:null,topics:[]}});
 if(path==='/api/zernio/accounts')return route.fulfill({json:[{id:'account-1',displayName:'Studio North',platform:'instagram',status:'expired',capabilities:['publish']}]});
 if(path==='/api/imports/google/connection')return route.fulfill({json:{connected:false}});
 return route.fulfill({json:[]});});
 await page.goto(options.initialPath ?? '/app');await expect(page.locator('[data-nav=start]')).toBeAttached();return mutations;
}
async function nav(page:Page,route:string){
 const menu=page.locator('.workspace-topbar .mobile-only');if(await menu.isVisible())await menu.click();
 const canonical:Record<string,string>={dashboard:'start',imports:'start',insights:'start',topics:'reports',notifications:'settings'};
 await page.locator(`[data-nav=${canonical[route]??route}]`).click();
 if(route==='imports')await page.getByRole('button',{name:/^(Source library|Biblioteca de fuentes|素材库)$/}).click();
 if(route==='insights')await page.getByRole('button',{name:/^(Structured templates|Plantillas|结构化模板)$/}).click();
 if(route==='topics')await page.getByRole('tab',{name:/^(Topics|Temas|主题)$/}).click();
 if(route==='notifications')await page.getByRole('tab',{name:/^(Digests & reminders|Resúmenes y recordatorios|摘要与提醒)$/}).click();
}
for(const locale of ['en','es','zh'])for(const size of ['desktop','mobile'])for(const route of ['dashboard','review','reports','imports','accounts','insights','pipelines','topics','notifications','activity','settings'])test(`${locale} ${size} ${route}: accessible and fits`,async({page})=>{
 await page.setViewportSize(size==='mobile'?{width:390,height:844}:{width:1440,height:1080});await fixture(page);await page.locator('#workspace-language').selectOption(locale);

  await nav(page,route);await expect(page.locator('main h1')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),route).toBeTruthy();
  await page.addScriptTag({content:axe.source});
  const result=await page.evaluate(async()=>{ const engine=(window as unknown as {axe: typeof axe}).axe; return engine.run(document, {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}); });expect(result.violations,`${locale} ${route}`).toEqual([]);
});
test('approval has an explicit immutable confirmation and updates home count',async({page})=>{const requests=await fixture(page);await nav(page,'review');await page.getByRole('button',{name:'Approve',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();expect(requests).toHaveLength(0);await expect(page.getByRole('dialog').locator('pre')).toHaveText(original);await page.getByRole('button',{name:'Confirm decision'}).click();await expect(page.getByRole('dialog')).not.toBeVisible();expect(requests[0]).toEqual({path:'/api/approval-requests/approval-1/approved',body:{}});await expect(page.locator('[data-nav=review] b')).toHaveCount(0);});
for (const locale of ['en', 'zh', 'es']) test(`${locale}: Sources exposes only CSV and Discord, without Google requests`, async ({ page }) => {
 const googleRequests: string[] = [];
 page.on('request', request => { if (request.url().includes('/api/imports/google/')) googleRequests.push(request.url()); });
 // Enter the deep link once: a second navigation cancels startup requests in WebKit.
 const mutations = await fixture(page, { initialPath: `/login?locale=${locale}#imports` });
 await page.getByText({en:'Import Discord messages',zh:'导入 Discord 消息',es:'Importar mensajes de Discord'}[locale],{exact:true}).first().click();
 await page.locator('#workspace-language').selectOption(locale);
 const main = page.locator('main');
 await expect(main.locator('input[type=file]')).toHaveCount(0);
 await expect(main.locator('input[inputmode=numeric]')).toBeVisible();
 await expect(main.getByText('Google Sheets', { exact: true })).toHaveCount(0);
 await expect(main.locator('input[placeholder*="docs.google.com"]')).toHaveCount(0);
 await expect(main.locator('textarea:visible')).toHaveCount(0);
 expect(googleRequests).toEqual([]);
 await page.getByLabel({en:'Source name',zh:'来源名称',es:'Nombre de fuente'}[locale],{exact:true}).last().fill('Discord regression');
 await main.locator('input[inputmode=numeric]').fill('123456789012345678');
 await main.getByRole('button', { name: { en: 'Import Discord messages', zh: '导入 Discord 消息', es: 'Importar mensajes de Discord' }[locale], exact: true }).click();
 await expect.poll(() => mutations.length).toBe(1);
 expect(mutations[0]).toMatchObject({ path: '/api/imports', body: { sourceType: 'discord', channelId: '123456789012345678' } });
});
test('mobile navigation traps focus, restores focus and supports 320px',async({page})=>{await page.setViewportSize({width:320,height:780});await fixture(page);const menu=page.getByRole('button',{name:'Open navigation',exact:true});await menu.click();await expect(page.getByRole('button',{name:'Close navigation'})).toBeFocused();await page.keyboard.press('Shift+Tab');expect(await page.evaluate(()=>!!document.activeElement?.closest('.workspace-sidebar'))).toBeTruthy();await page.keyboard.press('Escape');await expect(menu).toBeFocused();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();});
test('report evidence remains unchanged across UI language switches',async({page})=>{await fixture(page);await nav(page,'reports');await page.getByRole('button',{name:'Open report',exact:true}).click();await expect(page.locator('blockquote')).toContainText(original);await page.locator('#workspace-language').selectOption('zh');await expect(page.locator('blockquote')).toContainText(original);await expect(page.getByRole('button',{name:'保存核对与关注重点'})).toBeVisible();});

test('support floats above paused content, preserves failed input and creates a real ticket',async({page})=>{
 // Configure billing before navigation: reloading immediately after the sidebar mounts
 // cancels startup fetches and can raise a WebKit pageerror before support is exercised.
 await fixture(page, { paused: true });await expect(page.getByRole('heading',{name:'Automation is paused',exact:true})).toBeVisible();const calls:unknown[]=[];let fail=true;await page.route('**/api/feedback',route=>{calls.push(route.request().postDataJSON());return route.fulfill(fail?{status:503,json:{error:'unavailable'}}:{json:{ticketId:'PB-123'}})});
 await page.locator('#workspace-language').selectOption('zh');await page.getByRole('button',{name:'帮助与支持',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('textbox').fill('任务报告需要协助');await dialog.getByRole('combobox').selectOption('bug');await dialog.getByRole('button',{name:'提交支持工单'}).click();await expect(dialog.getByRole('status')).toContainText('提交失败');await expect(dialog.getByRole('textbox')).toHaveValue('任务报告需要协助');fail=false;await dialog.getByRole('button',{name:'提交支持工单'}).click();await expect(dialog.getByRole('status')).toContainText('PB-123');expect(calls[1]).toMatchObject({category:'bug',message:'任务报告需要协助',locale:'zh'});await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'帮助与支持',exact:true})).toBeFocused();
});
test('combined settings keeps Stripe management, upgrades, credits and account referral actions',async({page})=>{
 await fixture(page);await nav(page,'settings');for(const name of ['Manage subscription in Stripe','Upgrade Plan','Add AI Credits'])await expect(page.getByRole('button',{name,exact:true})).toBeEnabled();await page.getByRole('tab',{name:'Account & referrals',exact:true}).click();await expect(page.getByRole('button',{name:'Refresh ledger'})).toBeVisible();await expect(page.getByRole('button',{name:'Generate link'})).toBeVisible();await expect(page.getByText(/^Current plan:/)).toBeVisible();
});

test('B layout keeps the sidebar beside content at tablet widths and creates review screenshots',async({page})=>{
 await page.setViewportSize({width:820,height:1000});await fixture(page);const aside=await page.locator('.workspace-sidebar').boundingBox();const main=await page.locator('main').boundingBox();expect(main!.x).toBeGreaterThanOrEqual(aside!.x+aside!.width);await page.screenshot({path:'/tmp/piggy-b-phase-one-tablet.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'/tmp/piggy-b-phase-one-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/piggy-b-phase-one-mobile.png',fullPage:true});
});
