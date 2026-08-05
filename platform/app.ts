import type { Application } from 'egg';

import { AiRuntimeClient } from './src/ai-runtime/client';
import { Database } from './src/foundation/database';
import { loadGatewayConfig, loadWorkerConfig } from './src/foundation/platform-config';
import { PlatformOrm } from './src/foundation/sequelize';
import { PlatformService } from './src/egg/platform-service';
import { RunWorker } from './src/run-service/worker-runner';
import { ZernioClient } from './src/zernio/client';

export default class AppBootHook {
  constructor(private readonly app: Application) {}

  async didLoad(): Promise<void> {
    if (this.app.config.env === 'prod' && !process.env.EGG_COOKIE_KEYS) {
      throw new Error('EGG_COOKIE_KEYS is required in production');
    }
    const gatewayConfig = loadGatewayConfig();
    const workerConfig = loadWorkerConfig();
    if (gatewayConfig.DATABASE_URL !== workerConfig.DATABASE_URL) throw new Error('Gateway and worker must use the same DATABASE_URL');

    const database = new Database(gatewayConfig.DATABASE_URL);
    const orm = new PlatformOrm(gatewayConfig.DATABASE_URL);
    const zernio = workerConfig.ZERNIO_BASE_URL
      ? new ZernioClient({ baseUrl: workerConfig.ZERNIO_BASE_URL, oauthClientId: 'worker', oauthRedirectUri: 'http://localhost/unused', oauthStateSecret: 'worker-not-used' })
      : undefined;
    this.app.platform = {
      database,
      orm,
      service: new PlatformService(gatewayConfig, database, orm),
      worker: new RunWorker({
        workerName: workerConfig.WORKER_NAME,
        database,
        aiRuntime: new AiRuntimeClient({ baseUrl: workerConfig.AI_RUNTIME_URL, internalToken: workerConfig.INTERNAL_SERVICE_TOKEN }),
        zernio,
        secretEncryptionKeyBase64: workerConfig.SECRET_ENCRYPTION_KEY_BASE64,
      }),
      workerBatchSize: workerConfig.WORKER_BATCH_SIZE,
    };
  }

  async beforeClose(): Promise<void> {
    await Promise.all([this.app.platform.database.close(), this.app.platform.orm.close()]);
  }
}
