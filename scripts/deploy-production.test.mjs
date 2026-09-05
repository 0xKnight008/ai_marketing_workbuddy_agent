import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function preflight(t, privilegedAccess) {
  const dir = mkdtempSync(join(tmpdir(), 'piggybot-preflight-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // No real sudo or production secrets are used by these tests.
  writeFileSync(join(dir, 'sudo'), `#!/bin/sh\nexit ${privilegedAccess ? 0 : 1}\n`, { mode: 0o755 });
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
