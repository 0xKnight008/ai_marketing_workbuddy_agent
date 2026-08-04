import type { Context } from 'egg';

import { publicError } from '../../src/http/errors';

export default () => async (ctx: Context, next: () => Promise<void>) => {
  try {
    await next();
  } catch (error) {
    const response = publicError(error);
    if (response.statusCode >= 500) ctx.logger.error(error);
    ctx.status = response.statusCode;
    ctx.body = response.body;
  }
};
