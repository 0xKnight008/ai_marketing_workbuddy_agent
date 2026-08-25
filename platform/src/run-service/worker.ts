import { AiRuntimeClient } from '../ai-runtime/client';
import { Database } from '../foundation/database';
import { loadWorkerConfig } from '../foundation/platform-config';
import { ZernioClient } from '../zernio/client';
import { RunWorker } from './worker-runner';

async function main(): Promise<void> {
const config = loadWorkerConfig();
const database = new Database(config.DATABASE_URL);
const aiRuntime = new AiRuntimeClient({ baseUrl: config.AI_RUNTIME_URL, internalToken: config.INTERNAL_SERVICE_TOKEN });
const zernio = config.ZERNIO_BASE_URL
  ? new ZernioClient({ baseUrl: config.ZERNIO_BASE_URL, oauthClientId: 'worker', oauthRedirectUri: 'http://localhost/unused', oauthStateSecret: 'worker-not-used', globalRequestsPerMinute: config.ZERNIO_CLIENT_RPM })
  : undefined;
const worker = new RunWorker({
  workerName: config.WORKER_NAME,
  database,
  aiRuntime,
  zernio,
  stripeSecretKey: config.STRIPE_SECRET_KEY,
});

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { stopping = true; });

try {
  while (!stopping) {
    const processed = await worker.drain(config.WORKER_BATCH_SIZE);
    if (!processed) await new Promise((resolve) => setTimeout(resolve, config.WORKER_IDLE_MS));
  }
} finally {
  await database.close();
}
}

void main();
