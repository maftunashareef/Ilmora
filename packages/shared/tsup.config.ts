import { defineConfig } from 'tsup'

// Dual ESM (Next.js / Vite) + CommonJS (NestJS) build with type declarations.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: false,
  sourcemap: true,
  clean: false,
  target: 'es2022',
  platform: 'neutral',
  treeshake: true,
  splitting: false,
})
