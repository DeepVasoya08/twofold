import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../session';

const notOwner = 'Only the person who shared this library can do that.';

/** Owner-only routes refuse share tokens and upload-only tokens. */
export const requireOwner = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('member') !== null || c.get('access') === 'upload') {
    return c.json({ error: notOwner }, 403);
  }
  return next();
});
