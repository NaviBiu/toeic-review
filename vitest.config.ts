import { configDefaults, defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    setupFiles: [],
    exclude: [...configDefaults.exclude, '**/.worktrees/**'],
    // Live Neon integration tests make several serial round trips per case,
    // with the savepoint wrapper adding another round trip to every query.
    // A 15-second ceiling flakes under normal non-pooled endpoint latency.
    testTimeout: 60_000,
    // Integration tests each open their own Postgres connection against the
    // live Neon database. Running test files in parallel (Vitest's default)
    // exceeds Neon's free-tier connection limit and produces intermittent
    // connection-contention timeouts unrelated to any actual code defect
    // (found in Task 11). Serializing files keeps `npm test` reliably green.
    fileParallelism: false,
  },
});
