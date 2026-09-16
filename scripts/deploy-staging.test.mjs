import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// No real sudo, production secrets, or live services are used by these tests.
function fixture(t, { privilegedAccess = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'piggybot-staging-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'sudo'), `#!/bin/sh\nexit ${privilegedAccess ? 0 : 1}\n`, { mode: 0o755 });
  // Hermetic pg_dump so --check does not depend on host packages.
  writeFileSync(join(dir, 'pg_dump'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    PLATFORM_ENV_FILE: join(dir, 'platform.env'),
    AI_RUNTIME_ENV_FILE: join(dir, 'runtime.env'),
    DEPLOY_DIR: join(dir, 'deploy'),
    BACKUP_DIR: join(dir, 'backups'),
  };
  return { dir, env, run: (args = ['--check']) => spawnSync('bash', ['scripts/deploy-staging.sh', ...args], { env, encoding: 'utf8' }) };
}

function writeStagingEnv(env, overrides = {}) {
  const values = {
    DATABASE_URL: 'postgres://piggybot:secret@127.0.0.1:5432/piggybot_staging',
    GATEWAY_PORT: '4200',
    AI_RUNTIME_URL: 'http://127.0.0.1:4211',
    ...overrides,
  };
  writeFileSync(env.PLATFORM_ENV_FILE, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n'));
  writeFileSync(env.AI_RUNTIME_ENV_FILE, 'PORT=4211\n');
}

test('preflight accepts readable staging env files without loading their secret values', (t) => {
  const { env, run } = fixture(t);
  writeFileSync(env.PLATFORM_ENV_FILE, 'do-not-source-or-print-this-secret');
  writeFileSync(env.AI_RUNTIME_ENV_FILE, 'do-not-source-or-print-this-secret');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /do-not-source/);
});

test('preflight stops when staging env files are missing or inaccessible', (t) => {
  const { run } = fixture(t);
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /platform\.env/);
  assert.match(result.stderr, /missing or inaccessible/);
});

test('refuses production env file paths before touching anything', (t) => {
  const { env, run } = fixture(t);
  env.PLATFORM_ENV_FILE = '/etc/piggybot/platform.env';
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /production path/);
});

test('refuses production systemd unit names', (t) => {
  const { env, run } = fixture(t);
  env.STAGING_PLATFORM_UNIT = 'piggybot-platform';
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /production systemd unit/);
});

test('refuses a DATABASE_URL pointing at the production database', (t) => {
  const { env, run } = fixture(t);
  writeStagingEnv(env, { DATABASE_URL: 'postgres://piggybot:secret@127.0.0.1:5432/piggybot' });
  const result = run([]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /targets database 'piggybot', expected 'piggybot_staging'/);
});

test('refuses the production gateway port, including an unset GATEWAY_PORT', (t) => {
  const explicit = fixture(t);
  writeStagingEnv(explicit.env, { GATEWAY_PORT: '4100' });
  assert.match(explicit.run([]).stderr, /never the production port 4100/);

  const unset = fixture(t);
  writeStagingEnv(unset.env);
  // Remove the GATEWAY_PORT line entirely: the platform would default to 4100.
  const withoutPort = spawnSync('bash', ['-c', `grep -v '^GATEWAY_PORT=' "$1" > "$1.tmp" && mv "$1.tmp" "$1"`, '_', unset.env.PLATFORM_ENV_FILE]);
  assert.equal(withoutPort.status, 0);
  const result = unset.run([]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /GATEWAY_PORT must be set/);
});

test('refuses a staging ai-runtime bound to the production port', (t) => {
  const { env, run } = fixture(t);
  writeStagingEnv(env);
  writeFileSync(env.AI_RUNTIME_ENV_FILE, 'PORT=4111\n');
  const result = run([]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /never the production port 4111/);
});

test('refuses an AI_RUNTIME_URL pointing at the production ai-runtime', (t) => {
  const { env, run } = fixture(t);
  writeStagingEnv(env, { AI_RUNTIME_URL: 'http://127.0.0.1:4111' });
  const result = run([]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /never the production port 4111/);
});

test('guards pass with a valid staging configuration and fail later at the deploy dir', (t) => {
  const { env, run } = fixture(t);
  writeStagingEnv(env);
  mkdirSync(join(env.DEPLOY_DIR, 'platform'), { recursive: true });
  // npm ci fails in the empty stub directory — proving the guards passed and
  // execution reached the build phase without touching production paths.
  const result = run([]);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /Refusing to run/);
});
