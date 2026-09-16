import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCEPTANCE_TEMPLATES,
  DEFAULT_THRESHOLDS,
  buildAcceptanceDataset,
  buildVerdict,
  evaluateTemplateResult,
  formatMetricsTable,
  mintAccessToken,
  parseEnvFile,
  verifyAccessTokenLocally,
} from './acceptance-lib.mjs';

test('parseEnvFile handles comments, quotes, export prefixes and blank lines', () => {
  const parsed = parseEnvFile([
    '# comment',
    'DATABASE_URL=postgres://u:p@127.0.0.1:5432/piggybot_staging',
    'export QUOTED="value with spaces"',
    "SINGLE='single'",
    'EMPTY=',
    'not an assignment',
  ].join('\n'));
  assert.equal(parsed.DATABASE_URL, 'postgres://u:p@127.0.0.1:5432/piggybot_staging');
  assert.equal(parsed.QUOTED, 'value with spaces');
  assert.equal(parsed.SINGLE, 'single');
  assert.equal(parsed.EMPTY, '');
  assert.equal('not an assignment' in parsed, false);
});

test('mintAccessToken round-trips through the platform-compatible verifier', () => {
  const secret = 'a'.repeat(32);
  const token = mintAccessToken({ actorId: 'actor-1', workspaceId: 'ws-1', role: 'owner', ttlSeconds: 60 }, secret, 1_000);
  const claims = verifyAccessTokenLocally(token, secret, 1_000);
  assert.equal(claims.actorId, 'actor-1');
  assert.equal(claims.workspaceId, 'ws-1');
  assert.equal(claims.role, 'owner');
  assert.equal(claims.exp, 1_060);
  // Expired or tampered tokens are rejected.
  assert.equal(verifyAccessTokenLocally(token, secret, 2_000), null);
  assert.equal(verifyAccessTokenLocally(`${token.slice(0, -2)}xx`, secret, 1_000), null);
  assert.equal(verifyAccessTokenLocally(token, 'b'.repeat(32), 1_000), null);
});

test('mintAccessToken rejects short secrets and missing claims', () => {
  assert.throws(() => mintAccessToken({ actorId: 'a', workspaceId: 'w' }, 'short'), /32 characters/);
  assert.throws(() => mintAccessToken({ actorId: '', workspaceId: 'w' }, 'a'.repeat(32)), /required/);
});

test('buildAcceptanceDataset produces 500 well-formed CSV rows with SKU and metric coverage', () => {
  const { csv, itemCount } = buildAcceptanceDataset();
  assert.equal(itemCount, 500);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 501); // header + 500 rows
  assert.match(lines[0], /^platform,author,text,/);
  const parseLine = (line) => {
    const cells = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') { field += '"'; i += 1; } else if (char === '"') inQuotes = false;
        else field += char;
      } else if (char === '"') inQuotes = true;
      else if (char === ',') { cells.push(field); field = ''; }
      else field += char;
    }
    cells.push(field);
    return cells;
  };
  const skus = new Set();
  let rated = 0;
  for (const line of lines.slice(1)) {
    const cells = parseLine(line);
    assert.equal(cells.length, 11, line);
    if (cells[9]) skus.add(cells[9]);
    if (cells[8]) rated += 1;
  }
  assert.ok(skus.size >= 3, 'review rows carry multiple SKUs');
  assert.ok(rated >= 100, 'review rows carry ratings');
  // Deterministic: two builds are byte-identical.
  assert.equal(csv, buildAcceptanceDataset().csv);
});

test('evaluateTemplateResult passes a healthy generated report', () => {
  const issues = evaluateTemplateResult({
    template: 'content_recap', status: 'generated', latencyMs: 60_000,
    metrics: { groundedRate: 0.9, groundedConclusions: 8 },
    creditRows: [{ ai_credits: '1' }],
  });
  assert.deepEqual(issues, []);
});

test('evaluateTemplateResult flags failure, latency, grounding and credit defects', () => {
  assert.deepEqual(
    evaluateTemplateResult({ template: 'daily_ops', status: 'failed', error: 'insufficient_grounded_evidence' }),
    ['status=failed (insufficient_grounded_evidence)'],
  );
  const issues = evaluateTemplateResult({
    template: 'community_digest', status: 'generated', latencyMs: 11 * 60 * 1000,
    metrics: { groundedRate: 0.2, groundedConclusions: 0 },
    creditRows: [{ ai_credits: '1' }, { ai_credits: '1' }],
  });
  assert.equal(issues.length, 4);
  assert.ok(issues.some((issue) => issue.includes('latency')));
  assert.ok(issues.some((issue) => issue.includes('grounded rate')));
  assert.ok(issues.some((issue) => issue.includes('no grounded conclusions')));
  assert.ok(issues.some((issue) => issue.includes('exactly 1 credit reservation')));
  const zeroCredits = evaluateTemplateResult({
    template: 'daily_ops', status: 'generated', latencyMs: 1000,
    metrics: { groundedRate: 1, groundedConclusions: 3 },
    creditRows: [{ ai_credits: '0' }],
  });
  assert.ok(zeroCredits.some((issue) => issue.includes('zero AI credits')));
});

test('buildVerdict aggregates template and recovery outcomes', () => {
  const healthy = ACCEPTANCE_TEMPLATES.map((template) => ({
    template, status: 'generated', latencyMs: 1000,
    metrics: { groundedRate: 1, groundedConclusions: 2 },
    creditRows: [{ ai_credits: '1' }],
  }));
  assert.equal(buildVerdict(healthy, { pass: true }).pass, true);
  assert.equal(buildVerdict(healthy, { pass: false, issue: 'report failed instead of waiting' }).pass, false);
  const broken = healthy.map((row, index) => (index === 0 ? { ...row, status: 'failed' } : row));
  const verdict = buildVerdict(broken, { pass: true });
  assert.equal(verdict.pass, false);
  assert.ok(verdict.issues[0].startsWith('content_recap:'));
});

test('formatMetricsTable renders one row per template without secrets', () => {
  const verdict = buildVerdict([{
    template: 'daily_ops', status: 'generated', latencyMs: 65_000,
    metrics: { groundedRate: 0.75, groundedConclusions: 3 },
    creditRows: [{ ai_credits: '1' }],
  }], { pass: true }, DEFAULT_THRESHOLDS);
  const table = formatMetricsTable(verdict);
  assert.ok(table.includes('daily_ops'));
  assert.ok(table.includes('65.0s'));
  assert.ok(table.includes('75%'));
  assert.ok(table.includes('PASS'));
});
