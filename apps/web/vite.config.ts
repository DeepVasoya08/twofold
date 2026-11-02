import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

import { siteVerificationTag } from './src/build/site-verification';

/** Adds Google's site ownership tag to the page head when the build has a token. */
function googleSiteVerification(): Plugin {
  return {
    name: 'twofold-google-site-verification',
    transformIndexHtml(html) {
      const tag = siteVerificationTag(process.env.VITE_GOOGLE_SITE_VERIFICATION);
      return tag ? html.replace('</head>', `    ${tag}\n  </head>`) : html;
    },
  };
}

export default defineConfig({
  plugins: [react(), googleSiteVerification()],
  server: {
    // In dev, forward API calls to `wrangler dev` so the app keeps a single origin.
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    sourcemap: false,
    // libsodium (with Argon2id) is ~550 kB and loads on its own the first time keys are
    // needed, never on the welcome page.
    chunkSizeWarningLimit: 600,
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx'],
      reporter: ['text', 'lcov'],
    },
  },
});
