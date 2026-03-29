import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@webwaka/core': path.resolve(__dirname, 'src/__mocks__/@webwaka/core.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
      exclude: ['node_modules/', 'dist/', 'vitest.config.ts', 'src/__mocks__/'],
    },
  },
});
