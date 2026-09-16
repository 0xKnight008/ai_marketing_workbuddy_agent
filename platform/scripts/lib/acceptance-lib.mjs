/**
 * Pure helpers for the staging real-model acceptance run
 * (platform/scripts/staging-acceptance.mjs). No external dependencies so the
 * unit tests run anywhere Node does. Nothing in here may print or return
 * secret values.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const ACCEPTANCE_TEMPLATES = [
  'content_recap',
  'comment_insights',
  'product_opportunities',
  'review_attribution',
  'community_digest',
  'daily_ops',
];

export const ACCEPTANCE_WORKSPACE_SLUG = 'staging-acceptance';

/** Parse a systemd-style KEY=value env file without evaluating any value. */
export function parseEnvFile(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

/**
 * Mint an HS256 access token in the exact format platform/src/identity/token.ts
 * verifies. Used so the acceptance run can act as the workspace owner without
 * a browser login. The secret never leaves the host.
 */
export function mintAccessToken({ actorId, workspaceId, role = 'owner', ttlSeconds = 7200 }, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('AUTH_TOKEN_SECRET must be at least 32 characters');
  if (!actorId || !workspaceId) throw new Error('actorId and workspaceId are required');
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ actorId, workspaceId, role, exp: nowSeconds + ttlSeconds }));
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/** Self-check companion for mintAccessToken (mirrors the platform verifier). */
export function verifyAccessTokenLocally(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) return null;
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  const provided = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) return null;
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!claims.exp || claims.exp <= nowSeconds) return null;
  return claims;
}

function csvCell(value) {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Deterministic 500-item dataset covering all six templates: high-metric
 * content posts, fan comments with questions and demands, product requests,
 * SKU-tagged reviews, and community discussion. Texts repeat a small set of
 * realistic sentences with per-item suffixes so the LLM classifier sees
 * genuine (not random) content while the fixture stays fully reproducible.
 */
export function buildAcceptanceDataset() {
  const header = ['platform', 'author', 'text', 'views', 'likes', 'comments', 'shares', 'saves', 'rating', 'sku', 'published_at'];
  const rows = [];
  const push = (platform, author, text, metrics = {}) => {
    rows.push([
      platform, author, text,
      metrics.views ?? '', metrics.likes ?? '', metrics.comments ?? '', metrics.shares ?? '',
      metrics.saves ?? '', metrics.rating ?? '', metrics.sku ?? '', metrics.publishedAt ?? '2026-09-10',
    ]);
  };

  // 100 content posts with strong metrics (content_recap evidence).
  const contentThemes = [
    'Unboxing the new sticker pack and my desk setup tour',
    'How I edit my videos in 10 minutes with free tools',
    'Behind the scenes of this week\'s cozy vlog',
    'My top 5 productivity apps for creators',
    'Reading your comments while drinking matcha',
  ];
  for (let i = 0; i < 100; i += 1) {
    push('youtube', 'CreatorChannel', `${contentThemes[i % contentThemes.length]} (episode ${i + 1})`, {
      views: 8000 + (i % 50) * 1200, likes: 400 + (i % 40) * 90, comments: 60 + (i % 30) * 12,
      shares: 25 + (i % 20) * 8, saves: 90 + (i % 25) * 30,
    });
  }

  // 120 fan comments: questions, demands, purchase intent (comment_insights).
  const commentPool = [
    'When will the sticker pack restock? I missed the last drop',
    'Please make a tutorial on your editing workflow',
    'I would buy a hoodie with this design immediately',
    'Can you do a Q&A about your streaming setup?',
    'The link in the description is broken, please fix it',
    'Where did you get the desk lamp in the background?',
    'More behind the scenes videos please, these are the best',
    'Just ordered the sticker pack, so excited for it to arrive',
  ];
  for (let i = 0; i < 120; i += 1) {
    push('youtube', `Fan${(i % 37) + 1}`, `${commentPool[i % commentPool.length]} [comment ${i + 1}]`, { likes: 3 + (i % 15) });
  }

  // 80 product requests (product_opportunities).
  const productPool = [
    'Please make enamel pins of the mascot, I would preorder two',
    'A sticker sheet with the whole cast would sell out instantly',
    'Hoodies in sizes up to 3XL please, take my money',
    'You should make a desk mat with the episode 12 artwork',
    'Acrylic keychains of the cat character please',
    'A physical zine collecting the comic strips would be amazing',
  ];
  for (let i = 0; i < 80; i += 1) {
    push('instagram', `Shopper${(i % 23) + 1}`, `${productPool[i % productPool.length]} [request ${i + 1}]`, { likes: 5 + (i % 20) });
  }

  // 100 SKU-tagged reviews, mixed ratings (review_attribution).
  const reviewPool = [
    { rating: 2, text: 'The sticker pack arrived with bent corners because the envelope had no stiffener' },
    { rating: 1, text: 'Print colors are much duller than the listing photos, very disappointed' },
    { rating: 3, text: 'Shipping took three weeks to Canada, tracking never updated' },
    { rating: 5, text: 'Amazing quality, the holographic finish looks exactly like the photos' },
    { rating: 2, text: 'Size runs small, order one up; exchange process was smooth though' },
  ];
  const skus = ['STICKER-PACK-01', 'HOODIE-BLK-02', 'PIN-SET-03'];
  for (let i = 0; i < 100; i += 1) {
    const review = reviewPool[i % reviewPool.length];
    push('shopify', `Buyer${(i % 29) + 1}`, `${review.text} [order ${1000 + i}]`, {
      rating: review.rating, sku: skus[i % skus.length],
    });
  }

  // 100 community messages (community_digest).
  const communityPool = [
    'Has anyone received their sticker pack order yet? Mine is still pending',
    'Welcome to all the new members joining this week!',
    'Can we get a channel for sharing fan art?',
    'The watch party for the finale was so much fun, let\'s do another',
    'Reminder: please keep spoiler talk in the spoiler channel',
    'Does anyone know when the next merch drop is happening?',
    'I can help moderate the events channel if needed',
  ];
  for (let i = 0; i < 100; i += 1) {
    push('discord', `Member${(i % 31) + 1}`, `${communityPool[i % communityPool.length]} [msg ${i + 1}]`);
  }

  const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
  return { csv, itemCount: rows.length };
}

export const DEFAULT_THRESHOLDS = {
  minGroundedRate: 0.5,
  maxLatencyMs: 10 * 60 * 1000,
  minGroundedConclusions: 1,
};

/**
 * Evaluate one template's outcome. `result` shape:
 * { template, status, latencyMs, metrics, creditRows, error }
 * - metrics: report._metrics ({ groundedRate, groundedConclusions, ... }) or null
 * - creditRows: task_event rows for this report's reservation (must be exactly 1)
 */
export function evaluateTemplateResult(result, thresholds = DEFAULT_THRESHOLDS) {
  const issues = [];
  if (result.status !== 'generated') {
    issues.push(`status=${result.status}${result.error ? ` (${result.error})` : ''}`);
    return issues; // remaining checks are meaningless without a report
  }
  if (typeof result.latencyMs !== 'number' || result.latencyMs > thresholds.maxLatencyMs) {
    issues.push(`latency ${Math.round((result.latencyMs ?? Infinity) / 1000)}s exceeds ${Math.round(thresholds.maxLatencyMs / 1000)}s budget`);
  }
  const metrics = result.metrics ?? {};
  const groundedRate = typeof metrics.groundedRate === 'number' ? metrics.groundedRate : 0;
  if (groundedRate < thresholds.minGroundedRate) {
    issues.push(`grounded rate ${(groundedRate * 100).toFixed(1)}% below ${(thresholds.minGroundedRate * 100).toFixed(0)}% floor`);
  }
  if ((metrics.groundedConclusions ?? 0) < thresholds.minGroundedConclusions) {
    issues.push('no grounded conclusions survived verification');
  }
  if (!Array.isArray(result.creditRows) || result.creditRows.length !== 1) {
    issues.push(`expected exactly 1 credit reservation, found ${Array.isArray(result.creditRows) ? result.creditRows.length : 0}`);
  } else if (!(Number(result.creditRows[0].ai_credits) > 0)) {
    issues.push('credit reservation carries zero AI credits');
  }
  return issues;
}

/** Aggregate per-template rows + failure-recovery into a final verdict. */
export function buildVerdict(templateResults, failureRecovery, thresholds = DEFAULT_THRESHOLDS) {
  const rows = templateResults.map((result) => ({
    template: result.template,
    issues: evaluateTemplateResult(result, thresholds),
    result,
  }));
  const issues = [];
  for (const row of rows) {
    for (const issue of row.issues) issues.push(`${row.template}: ${issue}`);
  }
  if (failureRecovery && !failureRecovery.pass) {
    issues.push(`failure recovery: ${failureRecovery.issue}`);
  }
  return { pass: issues.length === 0, rows, issues };
}

/** Human-readable metrics table (no secrets, no customer data). */
export function formatMetricsTable(verdict) {
  const lines = [
    'template              | status     | latency | grounded | credits | result',
    '----------------------+------------+---------+----------+---------+-------',
  ];
  for (const row of verdict.rows) {
    const r = row.result;
    const latency = typeof r.latencyMs === 'number' ? `${(r.latencyMs / 1000).toFixed(1)}s` : '-';
    const grounded = r.metrics && typeof r.metrics.groundedRate === 'number' ? `${(r.metrics.groundedRate * 100).toFixed(0)}%` : '-';
    const credits = Array.isArray(r.creditRows) && r.creditRows[0] ? String(Number(r.creditRows[0].ai_credits)) : '-';
    lines.push(
      `${r.template.padEnd(22)}| ${String(r.status).padEnd(11)}| ${latency.padEnd(8)}| ${grounded.padEnd(9)}| ${credits.padEnd(8)}| ${row.issues.length === 0 ? 'PASS' : 'FAIL'}`,
    );
  }
  return lines.join('\n');
}
