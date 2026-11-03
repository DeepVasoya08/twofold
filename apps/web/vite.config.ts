import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

import { siteVerificationTag } from './src/build/site-verification';

/** Adds Google's site ownership tag to the page head when the build has a token. */
function googleSiteVerification(): Plugin {
  return {
    name: 'arcafold-google-site-verification',
    transformIndexHtml(html) {
      const tag = siteVerificationTag(process.env.VITE_GOOGLE_SITE_VERIFICATION);
      return tag ? html.replace('</head>', `    ${tag}\n  </head>`) : html;
    },
  };
}

/** Where pdf.js finds its fonts, character maps and image decoders, under the site root. */
const PDF_RESOURCES = '/pdfjs/';
const PDF_FOLDERS = ['cmaps', 'standard_fonts', 'wasm'];

/**
 * Serves pdf.js's own resources from this site (it fetches them by name from a folder, so
 * they can't be hashed assets): copied into the build, and served from node_modules in dev.
 * Nothing is fetched from anywhere else, so the content security policy stays 'self'.
 */
function pdfResources(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const files = PDF_FOLDERS.flatMap((folder) =>
    readdirSync(join(root, folder)).map((name) => `${folder}/${name}`),
  );
  let ssr = false;
  return {
    name: 'arcafold-pdf-resources',
    configResolved(config) {
      ssr = Boolean(config.build.ssr);
    },
    configureServer(server) {
      server.middlewares.use(PDF_RESOURCES, (request, response, next) => {
        const name = (request.url ?? '').replace(/^\//, '').split('?')[0] ?? '';
        if (!files.includes(name)) {
          next();
          return;
        }
        response.end(readFileSync(join(root, name)));
      });
    },
    generateBundle() {
      // The prerender build only renders pages; it needs none of these.
      if (ssr) return;
      for (const name of files) {
        this.emitFile({
          type: 'asset',
          fileName: `${PDF_RESOURCES.slice(1)}${name}`,
          source: readFileSync(join(root, name)),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), googleSiteVerification(), pdfResources()],
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
