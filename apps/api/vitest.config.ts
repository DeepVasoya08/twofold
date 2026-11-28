import { join } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Tests run in Node, not the Workers runtime, so its own module has a stand-in.
      'cloudflare:workers': join(import.meta.dirname, 'src/test/cloudflare-workers.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
