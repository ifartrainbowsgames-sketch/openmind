import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    // `runtimes/` holds the node-only external runtimes. They are outside
    // `src/` deliberately — they load node:child_process and must never be
    // reachable from the browser bundle — but their tests are part of the
    // suite, not an optional extra.
    include: ['src/**/*.test.{ts,tsx}', 'runtimes/**/*.test.ts'],
  },
})
