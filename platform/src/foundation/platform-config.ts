import { z } from 'zod';

/**
 * Process configuration belongs at the application boundary.  Services receive
 * explicit dependencies instead of reading process.env, which also makes them
 * safe to host from an Egg application lifecycle or a scheduled task.
 */
const databaseConfigSchema = z.object({
  DATABASE_URL: z.string().url(),
});
const zernioClientRpmSchema = z.coerce.number().int().min(1).max(100_000).default(480);

export const gatewayConfigSchema = databaseConfigSchema.extend({
  AUTH_TOKEN_SECRET: z.string().min(32),
  AI_RUNTIME_EVENT_SIGNING_SECRET: z.string().min(32),
  CORS_ORIGINS: z.string().min(1).default('http://localhost:5173').transform((value) =>
    value.split(',').map((origin) => origin.trim()).filter(Boolean),
  ),
  SECRET_ENCRYPTION_KEY_BASE64: z.string().min(1).optional(),
  ZERNIO_BASE_URL: z.string().url().optional(),
  ZERNIO_API_KEY: z.string().min(1).optional(),
  ZERNIO_OAUTH_REDIRECT_URI: z.string().url().optional(),
  ZERNIO_OAUTH_STATE_SECRET: z.string().min(32).optional(),
  ZERNIO_CLIENT_RPM: zernioClientRpmSchema,
  PUBLIC_SITE_URL: z.string().url().default('http://localhost:5173'),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  BILLING_ADMIN_TOKEN: z.string().min(32).optional(),
  STRIPE_PRICE_CREATOR: z.string().min(1).optional(),
  STRIPE_PRICE_GROWTH: z.string().min(1).optional(),
  STRIPE_PRICE_AGENCY: z.string().min(1).optional(),
  STRIPE_TRIAL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  STRIPE_PAYMENT_GRACE_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  STRIPE_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(1).max(3600).default(300),
  DISCORD_BOT_TOKEN: z.string().min(1).optional(),
  DISCORD_FEEDBACK_CHANNEL_ID: z.string().min(1).optional(),
  GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
});

export const workerConfigSchema = databaseConfigSchema.extend({
  AI_RUNTIME_URL: z.string().url(),
  INTERNAL_SERVICE_TOKEN: z.string().min(1),
  SECRET_ENCRYPTION_KEY_BASE64: z.string().min(1).optional(),
  ZERNIO_BASE_URL: z.string().url().optional(),
  ZERNIO_API_KEY: z.string().min(1).optional(),
  ZERNIO_CLIENT_RPM: zernioClientRpmSchema,
  WORKER_NAME: z.string().min(1).default('run-worker-1'),
  WORKER_IDLE_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(100),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
});

export type GatewayConfig = z.infer<typeof gatewayConfigSchema>;
export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export function loadGatewayConfig(environment: NodeJS.ProcessEnv = process.env): GatewayConfig {
  return gatewayConfigSchema.parse(environment);
}

export function loadWorkerConfig(environment: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return workerConfigSchema.parse(environment);
}
