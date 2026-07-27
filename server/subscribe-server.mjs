import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const DEFAULT_FORM_ID = '1FAIpQLSf0snTCY6aXd-eREWUYHvfHUPsdAxRLiCW2KxJanUQomT0ncA';
const DEFAULT_EMAIL_ENTRY = '1237653730';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BODY_BYTES = 4_096;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;
const MAX_REQUESTS_PER_WINDOW = 5;

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

async function readJson(request) {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new RequestError(415, 'unsupported_media_type');

  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw new RequestError(413, 'payload_too_large');
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

function createRateLimiter(now) {
  const requests = new Map();
  return (ip) => {
    const current = now();
    const active = (requests.get(ip) ?? []).filter((time) => current - time < RATE_LIMIT_WINDOW_MS);
    if (active.length >= MAX_REQUESTS_PER_WINDOW) return false;
    active.push(current);
    requests.set(ip, active);
    return true;
  };
}

export function createSubscriptionServer({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const formId = env.GOOGLE_FORM_ID ?? DEFAULT_FORM_ID;
  const emailEntry = env.GOOGLE_FORM_EMAIL_ENTRY ?? DEFAULT_EMAIL_ENTRY;
  if (!/^[A-Za-z0-9_-]{20,}$/.test(formId) || !/^\d+$/.test(emailEntry)) throw new Error('Google Form configuration is invalid');
  const allowRequest = createRateLimiter(now);

  return createServer(async (request, reply) => {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    if (request.method === 'GET' && pathname === '/health') return sendJson(reply, 200, { ok: true });
    if (request.method !== 'POST' || pathname !== '/api/subscribe') return sendJson(reply, 404, { error: 'not_found' });

    try {
      const body = await readJson(request);
      const email = typeof body?.email === 'string' ? body.email.trim() : '';
      if (!EMAIL_RE.test(email)) throw new RequestError(400, 'invalid_email');
      if (!allowRequest(clientIp(request))) throw new RequestError(429, 'rate_limited');

      const providerResponse = await fetchImpl(`https://docs.google.com/forms/d/e/${formId}/formResponse`, {
        body: new URLSearchParams({ [`entry.${emailEntry}`]: email }),
        headers: { Accept: 'text/html', 'Accept-Language': 'en', 'Content-Type': 'application/x-www-form-urlencoded' },
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      if (providerResponse.status < 200 || providerResponse.status >= 400) {
        console.error('Google Forms rejected subscription', { status: providerResponse.status });
        return sendJson(reply, 502, { error: 'subscription_unavailable' });
      }
      return sendJson(reply, 201, { accepted: true });
    } catch (error) {
      if (error instanceof RequestError) return sendJson(reply, error.statusCode, { error: error.code });
      console.error('Google Forms subscription failed', { message: error instanceof Error ? error.message : 'unknown_error' });
      return sendJson(reply, 502, { error: 'subscription_unavailable' });
    }
  });
}

export function startSubscriptionServer(options = {}) {
  const env = options.env ?? process.env;
  const port = Number.parseInt(env.PORT ?? '3001', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT is invalid');
  const server = createSubscriptionServer({ ...options, env });
  server.listen({ host: '0.0.0.0', port }, () => console.log(`Subscription server listening on ${port}`));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startSubscriptionServer();
