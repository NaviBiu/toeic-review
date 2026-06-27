import { defineConfig } from 'vitest/config';
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
    testTimeout: 15000,
    // Integration tests each open their own Postgres connection against the
    // live Neon database. Running test files in parallel (Vitest's default)
    // exceeds Neon's free-tier connection limit and produces intermittent
    // connection-contention timeouts unrelated to any actual code defect
    // (found in Task 11). Serializing files keeps `npm test` reliably green.
    fileParallelism: false,
  },
});
