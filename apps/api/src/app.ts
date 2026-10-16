import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

import type { HealthResponse } from '@twofold/types';

import { messages } from './respond';
import { account } from './routes/account';
import { auth } from './routes/auth';
import type { AppEnv } from './session';

/** API routes. The Worker only receives /api/* requests; static assets handle the rest. */
export const app = new Hono<AppEnv>().basePath('/api');

// API responses are JSON, never documents: lock them down harder than the web app's CSP.
app.use(
  secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    referrerPolicy: 'no-referrer',
    xFrameOptions: 'DENY',
    crossOriginResourcePolicy: 'same-origin',
  }),
);

// Account data must never be cached anywhere between the Worker and the browser.
app.use(async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

// Writes must be JSON. A cross-site form cannot send that content type without a CORS
// preflight, which this API never answers, so this backs up the SameSite=Strict cookie.
app.use(async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const type = c.req.header('content-type') ?? '';
    if (!/^application\/json(;|$)/i.test(type)) {
      return c.json({ error: messages.badRequest }, 415);
    }
  }
  return next();
});

app.get('/health', (c) => c.json<HealthResponse>({ status: 'ok' }));
app.route('/auth', auth);
app.route('/account', account);

app.onError((error, c) => {
  console.error('Unhandled API error', error.name);
  return c.json({ error: 'Something went wrong. Try again.' }, 500);
});
