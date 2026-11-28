import { app } from './app';
import { serveAppShell } from './app-shell';
import type { Env } from './env';
import { plainHttpOutsideDev } from './https';

/** The API's bindings plus the built web app, which only this entry point needs. */
interface WorkerEnv extends Env {
  ASSETS: Fetcher;
}

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === '/api' || pathname.startsWith('/api/')) return app.fetch(request, env, ctx);
    // A page asked for over plain http is sent to https (the API refuses http instead).
    if (plainHttpOutsideDev(url)) {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 308);
    }
    return serveAppShell(request, env.ASSETS);
  },
} satisfies ExportedHandler<WorkerEnv>;
