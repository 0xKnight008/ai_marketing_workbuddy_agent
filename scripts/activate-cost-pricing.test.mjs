import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,statSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {activation,activateFile} from './activate-cost-pricing.mjs';
test('cutover changes only mode and rollout marker, including quoted/exported env entries',()=>{
 for (const mode of ['legacy','shadow','cost-v1']) {
  const text=`# fixture\nSECRET='never log me'\nexport AI_METERING_MODE="${mode}" # current\n`;
  const result=activation(text);
  assert.equal(result, "# fixture\nSECRET='never log me'\nAI_METERING_MODE=cost-v1\nAI_CREDIT_ROLLOUT_VERSION=cost-106-v1\n");
  assert.equal(activation(result),null);
  assert.equal(activation(result.replace('MODE=cost-v1','MODE=legacy')),null);
 }
 assert.throws(()=>activation('AI_METERING_MODE=shadow\nAI_METERING_MODE=legacy'));
 assert.throws(()=>activation('AI_METERING_MODE=invalid'));
 assert.throws(()=>activation('AI_CREDIT_ROLLOUT_VERSION=future'));
});
test('atomic activation saves protected backup, keeps live permissions and is idempotent',t=>{
 const dir=mkdtempSync(join(tmpdir(),'piggy-cost106-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'platform.env'), original='SECRET=fixture\nAI_METERING_MODE=shadow\n';
 writeFileSync(path,original,{mode:0o640});
 const backup=activateFile(path);
 assert.equal(readFileSync(backup,'utf8'),original);
 assert.equal(statSync(backup).mode&0o777,0o600);
 assert.equal(statSync(path).mode&0o777,0o640);
 assert.equal(activateFile(path),'');
 assert.match(readFileSync(path,'utf8'),/AI_METERING_MODE=cost-v1/);
});
