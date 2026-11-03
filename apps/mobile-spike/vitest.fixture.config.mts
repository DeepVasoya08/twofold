import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['scripts/make-web-fixture.ts'], environment: 'node' },
});
