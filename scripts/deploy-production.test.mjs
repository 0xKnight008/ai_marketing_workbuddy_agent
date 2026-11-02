import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function preflight(t, privilegedAccess) {
  const dir = mkdtempSync(join(tmpdir(), 'piggybot-preflight-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // No real sudo or production secrets are used by these tests.
  writeFileSync(join(dir, 'sudo'), `#!/bin/sh\nexit ${privilegedAccess ? 0 : 1}\n`, { mode: 0o755 });
  // --check must only discover the backup tool, never execute it.
  writeFileSync(join(dir, 'pg_dump'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`,
    PLATFORM_ENV_FILE: join(dir, 'platform.env'), AI_RUNTIME_ENV_FILE: join(dir, 'runtime.env'),
    PUBLIC_API_ENV_FILE: join(dir, 'public.env'), DEPLOY_DIR: join(dir, 'must-not-be-touched') };
  return { dir, env, run: () => spawnSync('bash', ['scripts/deploy-production.sh', '--check'], { env, encoding: 'utf8' }) };
}

test('preflight accepts readable files without loading their secret values', (t) => {
  const fixture = preflight(t, false);
  for (const key of ['PLATFORM_ENV_FILE', 'AI_RUNTIME_ENV_FILE', 'PUBLIC_API_ENV_FILE']) {
    writeFileSync(fixture.env[key], 'do-not-source-or-print-this-secret');
  }
  const result = fixture.run();
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /do-not-source/);
});

test('preflight accepts protected files accessible through an existing sudo grant', (t) => {
  assert.equal(preflight(t, true).run().status, 0);
});

test('preflight stops before deployment when configuration is missing or inaccessible', (t) => {
  const result = preflight(t, false).run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /platform.env/);
  assert.match(result.stderr, /missing or inaccessible/);
  assert.doesNotMatch(result.stderr, /must-not-be-touched/);
});

function deployment(t, mode, failTests = false, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'piggybot-deploy-isolation-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const child of ['bin', 'platform', 'ai-runtime', 'scripts']) mkdirSync(join(dir, child));
  writeFileSync(join(dir, 'scripts/activate-cost-pricing.mjs'), readFileSync('scripts/activate-cost-pricing.mjs'));
  const bin = join(dir, 'bin');
  const log = join(dir, 'commands.jsonl');
  const executable = (name, source) => writeFileSync(join(bin, name), source, { mode: 0o755 });
  // Every privileged/network/DB command is a fixture. No real services are changed.
  executable('sudo', '#!/bin/sh\n[ "$1" != "-n" ] || shift\nexec "$@"\n');
  executable('npm', `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const record = {command:'npm', args, cwd:process.cwd(), mode:process.env.AI_METERING_MODE, ratesEmpty:process.env.AI_METERING_RATES_JSON === ''};
fs.appendFileSync(process.env.PIGGY_DEPLOY_TEST_LOG, JSON.stringify(record)+'\\n');
if (args.join(' ') === 'run metering:check' && process.env.PIGGY_FAIL_PREFLIGHT === '1') process.exit(61);
if (args[0] === 'test') {
  if (record.mode !== 'legacy' || !record.ratesEmpty) process.exit(42);
  if (process.env.PIGGY_DEPLOY_TEST_FAIL === '1') process.exit(37);
}
`);
  for (const name of ['docker', 'systemctl']) executable(name, `#!/usr/bin/env node
const fs=require('node:fs');
const args=process.argv.slice(2), previous=fs.readFileSync(process.env.PIGGY_DEPLOY_TEST_LOG,'utf8');
fs.appendFileSync(process.env.PIGGY_DEPLOY_TEST_LOG, JSON.stringify({command:${JSON.stringify(name)},args})+'\\n');
if (${JSON.stringify(name)}==='systemctl' && args.join(' ')==='restart piggybot-platform' && process.env.PIGGY_FAIL_RESTART==='1' && !previous.includes('"args":["restart","piggybot-platform"]')) process.exit(67);
`);
  executable('pg_dump', `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.PIGGY_DEPLOY_TEST_LOG, JSON.stringify({command:'pg_dump'})+'\\n');
const file=process.argv.slice(2).find(arg=>arg.startsWith('--file=')).slice(7);
require('node:fs').writeFileSync(file,'PGDMPfixture');
`);
  executable('curl', `#!/usr/bin/env node
const fs=require('node:fs');
const text=fs.readFileSync(process.env.PLATFORM_ENV_FILE,'utf8');
const mode=text.match(/^AI_METERING_MODE=(.+)$/m)?.[1]??'legacy';
console.log(JSON.stringify({ok:true,meteringMode:mode,creditPolicyVersion:'cost-106-v1'}));
`);
  const platformEnv = join(dir, 'platform.env');
  const secret = 'fixture-secret-must-not-be-printed';
  writeFileSync(platformEnv, `DATABASE_URL=postgres://fixture@127.0.0.1/fixture\nAI_METERING_MODE=${mode}\nAI_METERING_RATES_JSON='protected-production-rate-fixture'\nUNRELATED_SECRET=${secret}\n`);
  if(options.marker) writeFileSync(platformEnv, readFileSync(platformEnv,'utf8')+'AI_CREDIT_ROLLOUT_VERSION=cost-106-v1\n');
  writeFileSync(join(dir, 'runtime.env'), '# fixture\n');
  writeFileSync(join(dir, 'public.env'), '# fixture\n');
  const env = {...process.env, PATH:bin+':'+process.env.PATH, DEPLOY_DIR:dir,
    PLATFORM_ENV_FILE:platformEnv, AI_RUNTIME_ENV_FILE:join(dir,'runtime.env'), PUBLIC_API_ENV_FILE:join(dir,'public.env'),
    BACKUP_DIR:join(dir,'backups'), PIGGY_DEPLOY_TEST_LOG:log, PIGGY_DEPLOY_TEST_FAIL:failTests?'1':'0', PIGGY_FAIL_PREFLIGHT:options.failPreflight?'1':'0', PIGGY_FAIL_RESTART:options.failRestart?'1':'0'};
  const result = spawnSync('bash', ['scripts/deploy-production.sh'], {env, encoding:'utf8'});
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret+'|protected-production-rate-fixture'));
  return {result, environment:readFileSync(platformEnv,'utf8'), commands:readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line))};
}

for (const mode of ['legacy', 'shadow', 'cost-v1']) {
  test(`deployment isolates unit tests while preserving ${mode} for migration and readiness checks`, t => {
    const {result,commands,environment}=deployment(t,mode);
    assert.equal(result.status,0,result.stderr);
    assert.match(environment,/AI_METERING_MODE=cost-v1/);
    assert.match(environment,/AI_CREDIT_ROLLOUT_VERSION=cost-106-v1/);
    const preflight=commands.find(c=>c.command==='npm'&&c.args.join(' ')==='run metering:check');
    assert.equal(preflight.mode,'cost-v1');
    const tests=commands.filter(c=>c.command==='npm'&&c.args[0]==='test');
    assert.equal(tests.length,2);
    for (const invocation of tests) {
      assert.equal(invocation.mode,'legacy');
      assert.equal(invocation.ratesEmpty,true);
    }
    const migrate=commands.find(c=>c.command==='npm'&&c.args.join(' ')==='run migrate');
    assert.equal(migrate.mode,mode);
    assert.equal(migrate.ratesEmpty,false);
    assert.ok(commands.some(c=>c.command==='pg_dump'));
    assert.ok(commands.some(c=>c.command==='systemctl'&&c.args.join(' ')==='restart piggybot-platform'));
    assert.match(result.stdout,/Production deployment passed all health checks/);
  });
}

test('an actual unit-test failure still aborts deployment before backups or service changes', t => {
  const {result,commands}=deployment(t,'shadow',true);
  assert.equal(result.status,37,result.stderr);
  assert.equal(commands.some(c=>c.command==='docker'||c.command==='systemctl'||c.command==='pg_dump'),false);
  assert.equal(commands.some(c=>c.command==='npm'&&c.args.join(' ')==='run migrate'),false);
});

test('failed metering preflight never activates billing',t=>{
 const {result,environment}=deployment(t,'shadow',false,{failPreflight:true});
 assert.equal(result.status,61,result.stderr);
 assert.match(environment,/AI_METERING_MODE=shadow/);
 assert.doesNotMatch(environment,/AI_CREDIT_ROLLOUT_VERSION/);
});
test('failed platform restart restores the protected pre-cutover environment',t=>{
 const {result,environment}=deployment(t,'shadow',false,{failRestart:true});
 assert.equal(result.status,67,result.stderr);
 assert.match(environment,/AI_METERING_MODE=shadow/);
 assert.doesNotMatch(environment,/AI_CREDIT_ROLLOUT_VERSION/);
 assert.match(result.stderr,/Restored pre-cutover/);
});
test('subsequent deployments respect an operator rollback to shadow',t=>{
 const {result,environment,commands}=deployment(t,'shadow',false,{marker:true});
 assert.equal(result.status,0,result.stderr);
 assert.match(environment,/AI_METERING_MODE=shadow/);
 assert.equal(commands.some(c=>c.command==='npm'&&c.args.join(' ')==='run metering:check'),false);
});
