import 'egg';

import type { Database } from '../src/foundation/database';
import type { PlatformService } from '../src/egg/platform-service';
import type { RunWorker } from '../src/run-service/worker-runner';
import type { PlatformOrm } from '../src/foundation/sequelize';

declare module 'egg' {
  interface Application {
    platform: {
      database: Database;
      orm: PlatformOrm;
      service: PlatformService;
      worker: RunWorker;
      workerBatchSize: number;
    };
  }
}
