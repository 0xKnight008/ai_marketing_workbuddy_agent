import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Guard tests run before any privileged operation; no sudo or host state needed.
function run(env = {}) {
  return spawnSync('bash', ['scripts/provision-staging.sh'], { env: { ...process.env, ...env }, encoding: 'utf8' });
}

test('refuses the production env directory', () => {
  const result = run({ STAGING_ENV_DIR: '/etc/piggybot' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /production env directory/);
});

test('refuses the production backup directory', () => {
  const result = run({ BACKUP_DIR: '/var/backups/piggybot' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /production backup directory/);
});

test('refuses the production database name', () => {
  const result = run({ STAGING_DB_NAME: 'piggybot' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /production database name/);
});

test('stops when the deploy/staging repo files are absent', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'piggybot-provision-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = run({ REPO_DIR: dir });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing repo file: deploy\/staging/);
});

test('ships a complete staging asset set in the repo', () => {
  const result = spawnSync('bash', ['-c',
    'for f in deploy/staging/platform.env.example deploy/staging/ai-runtime.env.example deploy/staging/nginx-staging.conf deploy/staging/systemd/piggybot-platform-staging.service deploy/staging/systemd/piggybot-ai-runtime-staging.service; do [ -f "$f" ] || exit 1; done'],
    { encoding: 'utf8' });
  assert.equal(result.status, 0);
});
