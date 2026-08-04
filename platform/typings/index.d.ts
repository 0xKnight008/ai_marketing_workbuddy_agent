import 'egg';

import type { Database } from '../src/foundation/database';
import type { PlatformService } from '../src/egg/platform-service';
import type { RunWorker } from '../src/run-service/worker-runner';

declare module 'egg' {
  interface Application {
    platform: {
      database: Database;
      service: PlatformService;
      worker: RunWorker;
      workerBatchSize: number;
    };
  }
}
