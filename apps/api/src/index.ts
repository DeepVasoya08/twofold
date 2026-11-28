import { app } from './app';
import { serveAppShell } from './app-shell';
import type { Env } from './env';

export { AccountCounters } from './counters';

/** The API's bindings plus the built web app, which only this entry point needs. */
interface WorkerEnv extends Env {
  ASSETS: Fetcher;
}

export default {
  fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return app.fetch(request, env, ctx);
    return serveAppShell(request, env.ASSETS);
  },
} satisfies ExportedHandler<WorkerEnv>;
