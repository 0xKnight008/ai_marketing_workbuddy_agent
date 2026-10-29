import test from 'node:test';
import assert from 'node:assert/strict';
import {receiveCostReceipts} from './cost-metering';
const ws='11111111-1111-4111-8111-111111111111';
const rate={version:'opus-test',model:'primary-flagship',responseModels:['primary-flagship'],inputUsdPerMillion:'4',outputUsdPerMillion:'20',cacheUsdPerMillion:'0.2',cacheWrite5mUsdPerMillion:'5',cacheWrite1hUsdPerMillion:'8',source:'fixture',verifiedAt:'2026-10-29T00:00:00Z'};
test('Platform recomputes cache-write receipts rather than trusting Runtime cost; invalid totals stay unknown',async()=>{
 for(const cacheWrite5m of [60,101]){
  let stored:unknown[]=[];
  const tx={query:async(sql:string,args:unknown[])=>{
   if(sql.startsWith('SELECT o.rate'))return {rows:[{rate}],rowCount:1};
   if(sql.startsWith('INSERT INTO ai_cost_receipt')){stored=args;return {rows:[{id:ws}],rowCount:1};}
   return {rows:[],rowCount:1};
  }};
  await receiveCostReceipts(tx as any,ws,[{id:ws,workspaceId:ws,operationId:ws,requestId:ws,model:'primary-flagship',input:100,output:10,cached:0,cacheWrite5m,cacheWrite1h:40,costNanos:'1',status:'known'}]);
  assert.equal(stored[8],cacheWrite5m===60?'820000':null);
  assert.equal(stored[9],cacheWrite5m===60?'known':'unknown');
 }
});
