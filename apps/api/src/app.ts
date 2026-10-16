import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

import type { HealthResponse } from '@twofold/types';

import type { Env } from './env';

/** API routes. The Worker only receives /api/* requests; static assets handle the rest. */
export const app = new Hono<{ Bindings: Env }>().basePath('/api');

// API responses are JSON, never documents: lock them down harder than the web app's CSP.
app.use(
  secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    referrerPolicy: 'no-referrer',
    xFrameOptions: 'DENY',
    crossOriginResourcePolicy: 'same-origin',
  }),
);

app.get('/health', (c) => c.json<HealthResponse>({ status: 'ok' }));
