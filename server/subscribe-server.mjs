import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import pg from 'pg';

const { Pool } = pg;
const DEFAULT_FORM_ID = '1FAIpQLSf0snTCY6aXd-eREWUYHvfHUPsdAxRLiCW2KxJanUQomT0ncA';
const DEFAULT_EMAIL_ENTRY = '1237653730';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUBSCRIBE_MAX_BODY_BYTES = 4_096;
const FEEDBACK_MAX_BODY_BYTES = 8_192;
const SUBSCRIBE_RATE_LIMIT = { windowMs: 15 * 60 * 1_000, maxRequests: 5 };
const FEEDBACK_RATE_LIMIT = { windowMs: 10 * 60 * 1_000, maxRequests: 3 };
const CATEGORIES = new Set(['billing', 'bug', 'feature', 'other']);
const LOCALES = new Set(['zh', 'en', 'es']);

class RequestError extends Error {
  constructor(statusCode, code) {
    super(code);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function sendJson(reply, statusCode, body) {
  reply.writeHead(statusCode, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
  reply.end(JSON.stringify(body));
}

async function readJson(request, maxBytes) {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new RequestError(415, 'unsupported_media_type');

  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new RequestError(413, 'payload_too_large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError(400, 'invalid_json');
  }
}

function clientIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',', 1)[0].trim();
  return request.socket.remoteAddress ?? 'unknown';
}

function createRateLimiter(now, { windowMs, maxRequests }) {
  const requests = new Map();
  return (ip) => {
    const current = now();
    const active = (requests.get(ip) ?? []).filter((time) => current - time < windowMs);
    if (active.length >= maxRequests) return false;
    active.push(current);
    requests.set(ip, active);
    return true;
  };
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength + 1);
}

function cleanPageUrl(value) {
  if (typeof value !== 'string' || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function parseFeedback(body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = cleanText(body?.name, 120);
  const message = cleanText(body?.message, 2_000);
  const category = typeof body?.category === 'string' ? body.category : 'other';
  const locale = typeof body?.locale === 'string' && LOCALES.has(body.locale) ? body.locale : null;
  if (!EMAIL_RE.test(email)) throw new RequestError(400, 'invalid_email');
  if (!CATEGORIES.has(category)) throw new RequestError(400, 'invalid_category');
  if (!message) throw new RequestError(400, 'invalid_message');
  if (message.length > 2_000) throw new RequestError(400, 'message_too_long');
  return { category, email, locale, message, name: name || null, pageUrl: cleanPageUrl(body?.pageUrl) };
}

function createTicketNumber() {
  return `FB-${randomBytes(4).toString('hex').toUpperCase()}`;
}

export function createFeedbackStore(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  return {
    async create(feedback) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const ticketId = createTicketNumber();
        try {
          await pool.query(
            `INSERT INTO feedback_message (ticket_no, source, email, name, category, message, locale, page_url)
             VALUES ($1, 'web', $2, $3, $4, $5, $6, $7)`,
            [ticketId, feedback.email, feedback.name, feedback.category, feedback.message, feedback.locale, feedback.pageUrl],
          );
          return { ...feedback, ticketId };
        } catch (error) {
          if (error?.code !== '23505' || attempt === 2) throw error;
        }
      }
      throw new Error('ticket_generation_failed');
    },
    async setDiscordThread(ticketId, threadId) {
      await pool.query('UPDATE feedback_message SET discord_thread_id = $2 WHERE ticket_no = $1', [ticketId, threadId]);
    },
    async close() { await pool.end(); },
  };
}

async function verifyTurnstile(env, fetchImpl, token, ip) {
  if (!env.TURNSTILE_SECRET) return;
  if (typeof token !== 'string' || !token) throw new RequestError(403, 'challenge_failed');
  const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.success !== true) throw new RequestError(403, 'challenge_failed');
}

async function notifyDiscord(env, fetchImpl, feedbackStore, feedback) {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_FEEDBACK_CHANNEL_ID) return;
  const headers = { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' };
  const message = await fetchImpl(`https://discord.com/api/v10/channels/${env.DISCORD_FEEDBACK_CHANNEL_ID}/messages`, {
    method: 'POST', headers,
    body: JSON.stringify({ content: `**${feedback.ticketId}** · ${feedback.category}\n${feedback.email}${feedback.name ? ` (${feedback.name})` : ''}\n\n${feedback.message}` }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!message.ok) throw new Error(`discord_message_failed_${message.status}`);
  const posted = await message.json();
  const thread = await fetchImpl(`https://discord.com/api/v10/channels/${env.DISCORD_FEEDBACK_CHANNEL_ID}/messages/${posted.id}/threads`, {
    method: 'POST', headers,
    body: JSON.stringify({ name: `${feedback.ticketId} · ${feedback.category}`, auto_archive_duration: 1440 }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!thread.ok) throw new Error(`discord_thread_failed_${thread.status}`);
  const created = await thread.json();
  if (created?.id) await feedbackStore.setDiscordThread(feedback.ticketId, created.id);
}

export function createSubscriptionServer({ env = process.env, fetchImpl = fetch, now = Date.now, feedbackStore = env.DATABASE_URL ? createFeedbackStore(env.DATABASE_URL) : undefined } = {}) {
  const formId = env.GOOGLE_FORM_ID ?? DEFAULT_FORM_ID;
  const emailEntry = env.GOOGLE_FORM_EMAIL_ENTRY ?? DEFAULT_EMAIL_ENTRY;
  if (!/^[A-Za-z0-9_-]{20,}$/.test(formId) || !/^\d+$/.test(emailEntry)) throw new Error('Google Form configuration is invalid');
  const allowSubscribe = createRateLimiter(now, SUBSCRIBE_RATE_LIMIT);
  const allowFeedback = createRateLimiter(now, FEEDBACK_RATE_LIMIT);

  const server = createServer(async (request, reply) => {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    if (request.method === 'GET' && pathname === '/health') return sendJson(reply, 200, { ok: true });

    try {
      if (request.method === 'POST' && pathname === '/api/subscribe') {
        const body = await readJson(request, SUBSCRIBE_MAX_BODY_BYTES);
        const email = typeof body?.email === 'string' ? body.email.trim() : '';
        if (!EMAIL_RE.test(email)) throw new RequestError(400, 'invalid_email');
        if (!allowSubscribe(clientIp(request))) throw new RequestError(429, 'rate_limited');
        const providerResponse = await fetchImpl(`https://docs.google.com/forms/d/e/${formId}/formResponse`, {
          body: new URLSearchParams({ [`entry.${emailEntry}`]: email }),
          headers: { Accept: 'text/html', 'Accept-Language': 'en', 'Content-Type': 'application/x-www-form-urlencoded' },
          method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
        });
        if (providerResponse.status < 200 || providerResponse.status >= 400) {
          console.error('Google Forms rejected subscription', { status: providerResponse.status });
          return sendJson(reply, 502, { error: 'subscription_unavailable' });
        }
        return sendJson(reply, 201, { accepted: true });
      }

      if (request.method === 'POST' && pathname === '/api/feedback') {
        const body = await readJson(request, FEEDBACK_MAX_BODY_BYTES);
        // Deliberately acknowledge traps without storing data, so bots cannot
        // learn which field identified them.
        if (typeof body?.website === 'string' && body.website.trim()) return sendJson(reply, 200, { ticketId: 'FB-RECEIVED' });
        const ip = clientIp(request);
        const input = parseFeedback(body);
        if (!allowFeedback(ip)) throw new RequestError(429, 'rate_limited');
        if (!feedbackStore) throw new RequestError(503, 'feedback_unavailable');
        await verifyTurnstile(env, fetchImpl, body?.turnstileToken, ip);
        const feedback = await feedbackStore.create(input);
        try {
          await notifyDiscord(env, fetchImpl, feedbackStore, feedback);
        } catch (error) {
          console.error('Discord support notification failed', { ticketId: feedback.ticketId, message: error instanceof Error ? error.message : 'unknown_error' });
        }
        return sendJson(reply, 201, { ticketId: feedback.ticketId });
      }

      return sendJson(reply, 404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof RequestError) return sendJson(reply, error.statusCode, { error: error.code });
      console.error('Public API request failed', { message: error instanceof Error ? error.message : 'unknown_error' });
      return sendJson(reply, pathname === '/api/feedback' ? 503 : 502, { error: pathname === '/api/feedback' ? 'feedback_unavailable' : 'subscription_unavailable' });
    }
  });
  if (feedbackStore?.close) server.on('close', () => { void feedbackStore.close(); });
  return server;
}

export function startSubscriptionServer(options = {}) {
  const env = options.env ?? process.env;
  const port = Number.parseInt(env.PORT ?? '3001', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT is invalid');
  const server = createSubscriptionServer({ ...options, env });
  server.listen({ host: '0.0.0.0', port }, () => console.log(`Public API server listening on ${port}`));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startSubscriptionServer();
