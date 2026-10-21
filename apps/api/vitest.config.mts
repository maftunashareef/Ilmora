import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

// SWC keeps TypeScript decorator metadata, which NestJS dependency injection relies on.
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: { parser: { syntax: 'typescript', decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true }, target: 'es2022' },
    }),
  ],
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Database-backed tests share one schema; run files sequentially to keep them deterministic.
    fileParallelism: false,
    reporters: ['default'],
  },
})
