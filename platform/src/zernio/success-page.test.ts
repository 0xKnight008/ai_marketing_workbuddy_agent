import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {connectionSuccess} from './success-page';
test('callback CSP hashes the exact event-binding script and confines opener notification to site origin',()=>{
 for(const kind of ['zernio','google-sheets'] as const){
  const result=connectionSuccess(kind,'https://www.piggybot.me');
  const script=result.html.match(/<script>([\s\S]*)<\/script>/)?.[1];assert.ok(script);
  const hash=createHash('sha256').update(script).digest('base64');assert.ok(result.csp.includes(`'sha256-${hash}'`));
  assert.doesNotMatch(result.html,/onclick=/);assert.ok(script.includes('addEventListener'));assert.ok(script.includes('window.close()'));
  assert.ok(script.includes('"https://www.piggybot.me"'));assert.doesNotMatch(script,/postMessage\([^\n]*"\*"/);
 }
});
