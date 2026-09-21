import { test, expect, type Page } from '@playwright/test';
import axe from 'axe-core';
const original='¿Podrías hacer un tutorial paso a paso?';
const report={id:'report-1',title:'Audience requests',template:'community_digest',status:'generated',createdAt:'2026-09-18T10:00:00Z',modelBand:'eco',itemCount:2,droppedCitations:0,delivery:null,report:{_language:'es',summary:'Requests for clearer tutorials.',hotTopics:[{topic:'Step-by-step',citations:[{ref:'i1',snippet:original}]}],unresolvedQuestions:[],highValueMembers:[],conflictRisks:[],activityIdeas:[],announcementDraft:original}};
async function fixture(page:Page){
 page.on('pageerror',error=>{throw error;});
 let approvals=[{id:'approval-1',requestedAt:'2026-09-18T10:00:00Z',requestedAction:{summary:'Send saved draft',parameters:{content:original,subject:'[Piggybot] Audience requests',targetLabel:'review@example.invalid',channel:'email'}}}];
 const mutations:Array<{path:string;body:unknown}>=[];
 await page.addInitScript(()=>sessionStorage.setItem('piggybot.ownerAccessToken',`test.${btoa(JSON.stringify({exp:4102444800}))}.test`));
 await page.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;
 if(req.method()!=='GET')mutations.push({path,body:req.postDataJSON()});
 if(path==='/api/auth/me')return route.fulfill({json:{user:{email:'test@example.invalid',displayName:'Marco',passwordSet:true},workspace:{name:'Studio North'},role:'owner',plan:'growth',subscriptionStatus:'active'}});
 if(path==='/api/approval-requests')return route.fulfill({json:approvals});
 if(path.startsWith('/api/approval-requests/')){approvals=[];return route.fulfill({json:{status:'approved'}});}
 if(path==='/api/billing/usage')return route.fulfill({json:{status:'active',taskUsed:12,taskQuota:100,aiCreditsUsed:2,aiCreditsAvailable:100,plan:'growth',subscriptionStatus:'active'}});
 if(path==='/api/insights')return route.fulfill({json:req.method()==='POST'?{id:'report-new',status:'pending'}:[report]});
 if(path==='/api/insights/report-1')return route.fulfill({json:report});
 if(path.endsWith('/actions'))return route.fulfill({json:{actions:[],canEdit:true}});
 if(path==='/api/imports')return route.fulfill({json:req.method()==='POST'?{id:'batch-new',status:'pending'}:[{id:'batch-1',label:'Feedback',sourceType:'paste',status:'classified',itemCount:2,createdAt:'2026-09-18',modelBand:'eco',tagDistribution:{}}]});
 if(path==='/api/topics')return route.fulfill({json:{run:null,topics:[]}});
 if(path==='/api/zernio/accounts')return route.fulfill({json:[{id:'account-1',displayName:'Studio North',platform:'instagram',status:'expired',capabilities:['publish']}]});
 if(path==='/api/imports/google/connection')return route.fulfill({json:{connected:false}});
 return route.fulfill({json:[]});});
 await page.goto('/app');await expect(page.locator('[data-nav=dashboard]')).toBeAttached();return mutations;
}
async function nav(page:Page,route:string){const menu=page.locator('.workspace-topbar .mobile-only');if(await menu.isVisible())await menu.click();await page.locator(`[data-nav=${route}]`).click();}
for(const locale of ['en','es','zh'])for(const size of ['desktop','mobile'])for(const route of ['dashboard','review','reports','imports','accounts','insights','pipelines','topics','notifications','activity','settings'])test(`${locale} ${size} ${route}: accessible and fits`,async({page})=>{
 await page.setViewportSize(size==='mobile'?{width:390,height:844}:{width:1440,height:1080});await fixture(page);await page.locator('#workspace-language').selectOption(locale);

  await nav(page,route);await expect(page.locator('main h1')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),route).toBeTruthy();
  await page.addScriptTag({content:axe.source});
  const result=await page.evaluate(async()=>{ const engine=(window as unknown as {axe: typeof axe}).axe; return engine.run(document, {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}); });expect(result.violations,`${locale} ${route}`).toEqual([]);
});
test('approval has an explicit immutable confirmation and updates home count',async({page})=>{const requests=await fixture(page);await nav(page,'review');await page.getByRole('button',{name:'Approve',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();expect(requests).toHaveLength(0);await expect(page.getByRole('dialog').locator('pre')).toHaveText(original);await page.getByRole('button',{name:'Confirm decision'}).click();await expect(page.getByRole('dialog')).not.toBeVisible();expect(requests[0]).toEqual({path:'/api/approval-requests/approval-1/approved',body:{}});await nav(page,'dashboard');await expect(page.locator('.workspace-stats button').first().locator('strong')).toHaveText('0');});
test('imports preview before network mutation and preserve edits when language changes',async({page})=>{const requests=await fixture(page);await nav(page,'imports');await page.getByLabel('Batch label',{exact:true}).fill('September');await page.getByLabel('Paste content (one item per line)',{exact:true}).fill('First feedback\nSecond feedback');await page.getByRole('button',{name:'Preview import',exact:true}).click();await expect(page.getByRole('dialog').locator('pre')).toHaveCount(2);expect(requests).toHaveLength(0);await page.keyboard.press('Escape');await page.locator('#workspace-language').selectOption('es');await expect(page.locator('#import-label')).toHaveValue('September');await page.getByRole('button',{name:'Vista previa',exact:true}).click();await page.getByRole('button',{name:'Confirmar importación',exact:true}).click();expect(requests[0]).toMatchObject({path:'/api/imports',body:{label:'September',sourceType:'paste',content:'First feedback\nSecond feedback'}});});
test('content language reaches the backend independently of UI language',async({page})=>{const requests=await fixture(page);await nav(page,'insights');await page.getByLabel('Content language',{exact:true}).selectOption('es');await page.locator('#workspace-language').selectOption('zh');await page.getByRole('button',{name:'生成洞察报告',exact:true}).click();expect(requests[0]).toMatchObject({path:'/api/insights',body:{language:'es',template:'content_recap'}});});
test('mobile navigation traps focus, restores focus and supports 320px',async({page})=>{await page.setViewportSize({width:320,height:780});await fixture(page);const menu=page.getByRole('button',{name:'Open navigation',exact:true});await menu.click();await expect(page.getByRole('button',{name:'Close navigation'})).toBeFocused();await page.keyboard.press('Shift+Tab');expect(await page.evaluate(()=>!!document.activeElement?.closest('.workspace-sidebar'))).toBeTruthy();await page.keyboard.press('Escape');await expect(menu).toBeFocused();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();});
test('report evidence remains unchanged across UI language switches',async({page})=>{await fixture(page);await nav(page,'reports');await page.getByRole('button',{name:'Open report',exact:true}).click();await expect(page.locator('blockquote')).toContainText(original);await page.locator('#workspace-language').selectOption('zh');await expect(page.locator('blockquote')).toContainText(original);await expect(page.getByRole('button',{name:'返回报告'})).toBeVisible();});
