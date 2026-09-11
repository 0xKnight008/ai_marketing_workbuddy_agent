// This file is created by egg-ts-helper@2.1.1
// Do not modify this file!!!!!!!!!
/* eslint-disable */

import 'egg';
import ExportAdminEmailSession from '../../../app/middleware/admin-email-session';
import ExportPlatformCors from '../../../app/middleware/platform-cors';
import ExportPlatformError from '../../../app/middleware/platform-error';
import ExportRuntimeRawBody from '../../../app/middleware/runtime-raw-body';

declare module 'egg' {
  interface IMiddleware {
    adminEmailSession: typeof ExportAdminEmailSession;
    platformCors: typeof ExportPlatformCors;
    platformError: typeof ExportPlatformError;
    runtimeRawBody: typeof ExportRuntimeRawBody;
  }
}
