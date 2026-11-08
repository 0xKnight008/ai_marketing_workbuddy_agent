import {test,expect,type Page} from '@playwright/test';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {connectionSuccess}=require('../platform/src/zernio/success-page') as typeof import('../platform/src/zernio/success-page');
import axe from 'axe-core';
const id='11111111-1111-4111-8111-111111111111';
async function fixture(page:Page,locale='en',blocked=false){
 let removed=false;const deletes:unknown[]=[];
 await page.addInitScript(()=>{sessionStorage.setItem('piggybot.ownerAccessToken',`test.${btoa(JSON.stringify({exp:4102444800}))}.test`);localStorage.setItem('piggybot.appearance','light');});
 await page.route('**/api/**',route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/auth/me')return route.fulfill({json:{user:{email:'owner@example.invalid',displayName:'Owner',passwordSet:true},workspace:{id:'workspace',name:'Cleanup workspace'},role:'owner',plan:'creator',subscriptionStatus:'active'}});
  if(path==='/api/billing/usage')return route.fulfill({json:{status:'normal',subscriptionStatus:'active',aiCreditsAvailable:100,aiCreditsUsed:0,taskUsed:0,taskQuota:100,plan:'creator'}});
  if(path==='/api/imports')return route.fulfill({json:removed?[]:[{id,label:'Disposable source',status:'classified',itemCount:3,modelBand:'eco',sourceType:'paste',tagDistribution:{}}]});
  if(path===`/api/imports/${id}`&&req.method()==='DELETE'){
   deletes.push(req.postDataJSON());if(blocked)return route.fulfill({status:409,json:{error:'import_in_use'}});
   removed=true;return route.fulfill({json:{id,deleted:true}});
  }
  if(path==='/api/topics')return route.fulfill({json:{run:null,topics:[]}});
  if(path==='/api/task-preferences')return route.fulfill({json:{persona:'creators',modelBand:'eco',language:locale,goal:''}});
  return route.fulfill({json:[]});
 });
 await page.goto(`/login?locale=${locale}#imports`,{waitUntil:'domcontentloaded'});
 await expect(page.locator('[data-nav=start]')).toBeVisible();
 return deletes;
}
for(const locale of ['en','zh','es'] as const)test(`${locale}: source deletion confirms permanence and removes the item; appearance has only system and dark`,async({page})=>{
 await page.setViewportSize({width:390,height:1000});await page.emulateMedia({colorScheme:'light'});
 const deletes=await fixture(page,locale);
 const appearance=page.getByLabel({en:'Appearance',zh:'外观显示',es:'Apariencia'}[locale]);
 await expect(appearance).toHaveValue('system');await expect(appearance.locator('option')).toHaveCount(2);
 await appearance.selectOption('dark');await expect(page.locator('html')).toHaveAttribute('data-workspace-theme','dark');
 await page.getByRole('button',{name:new RegExp(' · Disposable source$')}).click();
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();expect(deletes).toEqual([]);
 await expect(dialog).toContainText({en:'cannot be undone',zh:'删除后不可恢复',es:'no se puede deshacer'}[locale]);
 await page.addScriptTag({content:axe.source});expect(await page.evaluate(async()=> (await (window as any).axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations)).toEqual([]);
 await dialog.getByRole('button',{name:{en:'Confirm permanent deletion',zh:'确认永久删除',es:'Confirmar eliminación permanente'}[locale],exact:true}).click();
 await expect(dialog).not.toBeVisible();await expect(page.getByText('Disposable source',{exact:true})).toHaveCount(0);expect(deletes).toEqual([{confirm:true}]);
});
test('source in use is not hidden on failed deletion',async({page})=>{
 const deletes=await fixture(page,'en',true);await page.getByRole('button',{name:'Delete source · Disposable source'}).click();
 await page.getByRole('button',{name:'Confirm permanent deletion',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('queued or running work');await expect(page.getByRole('dialog')).toBeVisible();expect(deletes).toEqual([{confirm:true}]);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByText('Disposable source',{exact:true})).toBeVisible();
});
for(const kind of ['zernio','google-sheets'] as const)test(`${kind}: CSP allows the connection popup close button without inline handlers`,async({page})=>{
 await page.route('**/opener-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>OAuth opener</title><p>Connection test</p>'}));
 await page.goto('/opener-fixture',{waitUntil:'domcontentloaded'});
 const success=connectionSuccess(kind,'http://127.0.0.1:5178');
 await page.context().route('**/callback-fixture',route=>route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':success.csp},body:success.html}));
 const popupPromise=page.waitForEvent('popup');await page.evaluate(()=>window.open('/callback-fixture','oauth-test','popup,width=720,height=820'));
 const popup=await popupPromise;await expect(popup.getByRole('heading',{name:'Account connected',exact:true})).toBeVisible();
 const closed=popup.waitForEvent('close');await popup.getByRole('button',{name:/Close this window/}).click();await closed;
});
test('standalone connection callback always offers a safe return link',async({page})=>{
 const success=connectionSuccess('zernio','http://127.0.0.1:5178');
 await page.context().route('**/callback-fixture',route=>route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':success.csp},body:success.html}));
 await page.goto('/callback-fixture',{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('link',{name:/Return to Piggybot/})).toHaveAttribute('href','http://127.0.0.1:5178/login#accounts');
});
for(const locale of ['en','zh','es'] as const)test(`${locale}: activity keeps AI reservations and renders scheduling and publishing records`,async({page})=>{
 await fixture(page,locale);
 await page.route('**/api/billing/task-events',route=>route.fulfill({json:[{id:'credit',actionType:'ai.insight',aiCredits:'2',billableUnits:0,status:'posted',reservationState:'reserved',createdAt:'2026-11-08T00:00:00Z'}]}));
 await page.route('**/api/audit-events',route=>route.fulfill({json:[{id:'schedule',eventType:'feedback.schedule_authorized',payload:{name:'Daily feedback'},createdAt:'2026-11-08T00:00:00Z'},{id:'publish',eventType:'publishing.succeeded',payload:{name:'Published story'},createdAt:'2026-11-08T00:00:00Z'}]}));
 await page.goto(`/login?locale=${locale}#activity`,{waitUntil:'domcontentloaded'});
 // Hash-only navigation reuses already-loaded workspace data; reload after installing activity responses.
 await page.reload({waitUntil:'domcontentloaded'});
 await expect(page.getByText(/ai.insight: .*2 credit/)).toBeVisible();
 await expect(page.getByText({en:'Scheduled task authorized',zh:'定时任务已授权',es:'Tarea programada autorizada'}[locale],{exact:true})).toBeVisible();
 await expect(page.getByText('Daily feedback',{exact:true})).toBeVisible();await expect(page.getByText('Published story',{exact:true})).toBeVisible();
});
