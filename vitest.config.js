import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/middleware/**'],
      exclude: ['src/server.js'],
      thresholds: {
        lines: 60,
        branches: 50,
        functions: 60,
      },
    },
  },
});
