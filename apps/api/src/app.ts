import { Hono } from 'hono';

import type { HealthResponse } from '@twofold/types';

import type { Env } from './env';

export const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json<HealthResponse>({ status: 'ok' }));
