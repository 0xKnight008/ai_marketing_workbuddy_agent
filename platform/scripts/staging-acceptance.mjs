#!/usr/bin/env node
/**
 * Real-model six-template acceptance for the staging isolated stack.
 *
 * Runs the full pipeline against a live staging deployment with real models:
 *   health → seed workspace → import 500-item deterministic dataset (real
 *   classification) → generate all six insight templates → measure latency,
 *   grounded-evidence rate and credit accounting per template → stop the
 *   ai-runtime mid-run and verify the queue recovers without double-charging.
 *
 * Usage (on the staging host, from the platform directory):
 *   node scripts/staging-acceptance.mjs [--skip-failure-recovery]
 *     [--env-file /etc/piggybot-staging/platform.env] [--base-url http://127.0.0.1:4200]
 *     [--min-grounded-rate 0.5] [--max-latency-ms 600000]
 *
 * Security: reads the staging env file only to reach the database and mint a
 * workspace-owner token; never prints env values, tokens, or dataset content.
 * Each run creates a fresh workspace (staging data is disposable; reset the
 * database via drop/create + migrate when it grows).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import pg from 'pg';

import {
  ACCEPTANCE_TEMPLATES,
  DEFAULT_THRESHOLDS,
  buildAcceptanceDataset,
  buildVerdict,
  formatMetricsTable,
  mintAccessToken,
  parseEnvFile,
} from './lib/acceptance-lib.mjs';

const RUNTIME_UNIT = process.env.STAGING_RUNTIME_UNIT ?? 'piggybot-ai-runtime-staging';

// Cloudflare Access service token, required when probing
// staging.piggybot.me from outside the origin host. Leave unset when
// running on the staging host against 127.0.0.1:4200.
const CF_ACCESS_HEADERS = {};
if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
  CF_ACCESS_HEADERS['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID;
  CF_ACCESS_HEADERS['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET;
}

function withCfAccess(headers) {
  return { ...CF_ACCESS_HEADERS, ...headers };
}

function usage(exitCode) {
  console.log(`Usage: node scripts/staging-acceptance.mjs [options]

Options:
  --env-file PATH          Staging platform env file (default /etc/piggybot-staging/platform.env)
  --base-url URL           Staging gateway base URL (default http://127.0.0.1:<GATEWAY_PORT|4200>)
  --min-grounded-rate N    Minimum grounded-evidence rate per template (default ${DEFAULT_THRESHOLDS.minGroundedRate})
  --max-latency-ms N       Per-template latency budget (default ${DEFAULT_THRESHOLDS.maxLatencyMs})
  --skip-failure-recovery  Skip the ai-runtime stop/start recovery test
  --help                   Show this message`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const options = { envFile: '/etc/piggybot-staging/platform.env', baseUrl: undefined, skipFailureRecovery: false, thresholds: { ...DEFAULT_THRESHOLDS } };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') usage(0);
    else if (arg === '--skip-failure-recovery') options.skipFailureRecovery = true;
    else if (arg === '--env-file') options.envFile = argv[++i];
    else if (arg === '--base-url') options.baseUrl = argv[++i];
    else if (arg === '--min-grounded-rate') options.thresholds.minGroundedRate = Number(argv[++i]);
    else if (arg === '--max-latency-ms') options.thresholds.maxLatencyMs = Number(argv[++i]);
    else { console.error(`Unknown option: ${arg}`); usage(1); }
  }
  if (!(options.thresholds.minGroundedRate >= 0 && options.thresholds.minGroundedRate <= 1)) {
    console.error('--min-grounded-rate must be between 0 and 1');
    usage(1);
  }
  return options;
}

/** Read an env file that may be root-only (uses the existing sudo grant). */
function readEnvFile(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code !== 'EACCES' && error.code !== 'EPERM') throw error;
    const result = spawnSync('sudo', ['-n', 'cat', '--', path], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Cannot read ${fileName(path)}: permission denied and non-interactive sudo unavailable`);
    return result.stdout;
  }
}

function fileName(path) {
  return path.split('/').pop();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(baseUrl, token, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: withCfAccess({ authorization: `Bearer ${token}`, 'content-type': 'application/json' }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!response.ok) {
    const code = parsed && typeof parsed.error === 'string' ? parsed.error : `http_${response.status}`;
    throw new Error(`${method} ${path} failed: ${code}`);
  }
  return parsed;
}

async function pollUntil(label, timeoutMs, check) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value.done) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${label} after ${Math.round(timeoutMs / 1000)}s`);
    await sleep(5_000);
  }
}

function systemctl(action, unit) {
  const result = spawnSync('sudo', ['-n', 'systemctl', action, unit], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`systemctl ${action} ${unit} failed (needs a non-interactive sudo grant)`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = parseEnvFile(readEnvFile(options.envFile));
  for (const key of ['DATABASE_URL', 'AUTH_TOKEN_SECRET', 'AI_RUNTIME_URL']) {
    if (!env[key]) throw new Error(`${key} is missing from ${fileName(options.envFile)}`);
  }
  const baseUrl = (options.baseUrl ?? `http://127.0.0.1:${env.GATEWAY_PORT ?? '4200'}`).replace(/\/+$/, '');

  console.log('==> Health checks');
  const platformHealth = await fetch(`${baseUrl}/internal/ready`, {
    signal: AbortSignal.timeout(10_000), headers: withCfAccess({}),
  });
  if (!platformHealth.ok) throw new Error(`staging platform is not ready at ${baseUrl} (HTTP ${platformHealth.status})`);
  const runtimeHealth = await fetch(`${env.AI_RUNTIME_URL}/internal/health`, {
    signal: AbortSignal.timeout(10_000), headers: withCfAccess({}),
  });
  if (!runtimeHealth.ok) throw new Error('staging ai-runtime is not healthy');
  console.log('    platform and ai-runtime are healthy');

  console.log('==> Seeding an isolated acceptance workspace');
  const database = new pg.Client({ connectionString: env.DATABASE_URL });
  await database.connect();
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  let workspaceId; let actorId;
  try {
    const user = await database.query(
      'INSERT INTO app_user (email, display_name) VALUES ($1, $2) RETURNING id',
      [`staging-acceptance+${stamp}@example.invalid`, 'Staging Acceptance'],
    );
    actorId = user.rows[0].id;
    const workspace = await database.query(
      'INSERT INTO workspace (name, slug) VALUES ($1, $2) RETURNING id',
      [`Staging Acceptance ${stamp}`, `staging-acceptance-${stamp}`],
    );
    workspaceId = workspace.rows[0].id;
    await database.query(
      "INSERT INTO workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
      [workspaceId, actorId],
    );
    await database.query('BEGIN');
    await database.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
    await database.query(
      `INSERT INTO workspace_billing (workspace_id, plan, subscription_status, purchased_ai_credits, activated_at)
       VALUES (current_setting('app.workspace_id')::uuid, 'agency', 'active', 10000, now())`,
    );
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK').catch(() => {});
    await database.end().catch(() => {});
    throw error;
  }
  console.log(`    workspace ${workspaceId}`);

  const token = mintAccessToken({ actorId, workspaceId, role: 'owner' }, env.AUTH_TOKEN_SECRET);

  console.log('==> Importing the deterministic 500-item dataset (real classification)');
  const dataset = buildAcceptanceDataset();
  const batch = await api(baseUrl, token, 'POST', '/api/imports', {
    label: `staging-acceptance-${stamp}`, sourceType: 'csv', content: dataset.csv, modelBand: 'eco',
  });
  const batchState = await pollUntil('import classification', 90 * 60 * 1000, async () => {
    const view = await api(baseUrl, token, 'GET', `/api/imports/${batch.id}`);
    if (view.status === 'classified') return { done: true, view };
    if (view.status === 'failed') throw new Error('import classification failed on staging');
    return { done: false };
  });
  console.log(`    batch ${batch.id} classified (${batchState.view.itemCount} items)`);

  const creditRowsFor = async (reportId) => {
    await database.query('BEGIN');
    try {
      await database.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      const rows = await database.query(
        `SELECT ai_credits, action_type, attempt FROM task_event
          WHERE workspace_id = current_setting('app.workspace_id')::uuid
            AND subject_id = $1::uuid AND (action_type = 'ai.insight' OR action_type LIKE 'ai.insight.%') AND attempt = 1`,
        [reportId],
      );
      await database.query('COMMIT');
      return rows.rows;
    } catch (error) {
      await database.query('ROLLBACK').catch(() => {});
      throw error;
    }
  };

  const generateAndMeasure = async (template) => {
    const started = Date.now();
    const created = await api(baseUrl, token, 'POST', '/api/insights', { template, batchIds: [batch.id], modelBand: 'eco' });
    const final = await pollUntil(`${template} generation`, options.thresholds.maxLatencyMs + 60_000, async () => {
      const view = await api(baseUrl, token, 'GET', `/api/insights/${created.id}`);
      if (view.status === 'generated' || view.status === 'failed') return { done: true, view };
      return { done: false };
    });
    const latencyMs = Date.now() - started;
    const view = final.view;
    return {
      template,
      status: view.status,
      error: view.error ?? undefined,
      latencyMs,
      metrics: view.report && typeof view.report === 'object' ? view.report._metrics ?? null : null,
      creditRows: await creditRowsFor(created.id),
      reportId: created.id,
    };
  };

  console.log('==> Generating the six insight templates with real models');
  const results = [];
  for (const template of ACCEPTANCE_TEMPLATES) {
    process.stdout.write(`    ${template} ... `);
    const result = await generateAndMeasure(template);
    results.push(result);
    console.log(`${result.status} in ${(result.latencyMs / 1000).toFixed(1)}s`);
  }

  let failureRecovery;
  if (options.skipFailureRecovery) {
    failureRecovery = { pass: true, issue: undefined, skipped: true };
    console.log('==> Failure recovery: skipped (--skip-failure-recovery)');
  } else {
    console.log(`==> Failure recovery: stopping ${RUNTIME_UNIT} mid-run`);
    let runtimeStopped = false;
    try {
      systemctl('stop', RUNTIME_UNIT);
      runtimeStopped = true;
      const started = Date.now();
      const created = await api(baseUrl, token, 'POST', '/api/insights', { template: 'daily_ops', batchIds: [batch.id], modelBand: 'eco' });
      await sleep(30_000);
      const midView = await api(baseUrl, token, 'GET', `/api/insights/${created.id}`);
      if (midView.status === 'failed') {
        failureRecovery = { pass: false, issue: 'report failed instead of waiting for the ai-runtime to return' };
      } else if (midView.status === 'generated') {
        failureRecovery = { pass: false, issue: 'report completed while the ai-runtime was stopped' };
      } else {
        console.log(`    report held in ${midView.status}; restarting ${RUNTIME_UNIT}`);
        systemctl('start', RUNTIME_UNIT);
        runtimeStopped = false;
        const final = await pollUntil('recovery generation', options.thresholds.maxLatencyMs + 120_000, async () => {
          const view = await api(baseUrl, token, 'GET', `/api/insights/${created.id}`);
          if (view.status === 'generated' || view.status === 'failed') return { done: true, view };
          return { done: false };
        });
        const creditRows = await creditRowsFor(created.id);
        if (final.view.status !== 'generated') {
          failureRecovery = { pass: false, issue: `report ended in ${final.view.status} after the ai-runtime restarted` };
        } else if (creditRows.length !== 1) {
          failureRecovery = { pass: false, issue: `expected exactly 1 credit reservation after retry, found ${creditRows.length}` };
        } else {
          failureRecovery = { pass: true, issue: undefined, latencyMs: Date.now() - started };
          console.log(`    recovered and generated in ${((Date.now() - started) / 1000).toFixed(1)}s with exactly one credit charge`);
        }
      }
    } catch (error) {
      failureRecovery = { pass: false, issue: error.message };
    } finally {
      if (runtimeStopped) {
        try { systemctl('start', RUNTIME_UNIT); } catch (error) { console.error(`    WARNING: could not restart ${RUNTIME_UNIT}: ${error.message}`); }
      }
    }
  }

  await database.end();

  const verdict = buildVerdict(results, failureRecovery, options.thresholds);
  console.log('\n' + formatMetricsTable(verdict));
  if (verdict.issues.length) {
    console.log('\nIssues:');
    for (const issue of verdict.issues) console.log(`  - ${issue}`);
  }
  console.log(`\nStaging acceptance: ${verdict.pass ? 'PASS' : 'FAIL'}`);
  process.exit(verdict.pass ? 0 : 1);
}

main().catch((error) => {
  console.error(`Staging acceptance aborted: ${error.message}`);
  process.exit(1);
});
