import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    // In dev, forward API calls to `wrangler dev` so the app keeps a single origin.
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    sourcemap: false,
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
