import { defineConfig } from 'prisma/config'

// Load .env for local CLI use without an extra dependency (Node 21+). Ignored when the file is absent.
try {
  process.loadEnvFile?.('.env')
} catch {
  /* no .env file: variables come from the environment */
}

// Prisma 7 configuration. The datasource URL is read from the environment (never committed).
// DATABASE_URL          — runtime connection (app user, limited privileges).
// DATABASE_MIGRATE_URL  — optional separate connection for migrations (owner role); falls back to DATABASE_URL.
// SHADOW_DATABASE_URL   — scratch database for `prisma migrate diff --from-migrations` (CI drift check); never production.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL ?? 'postgresql://ilmora:ilmora@localhost:5432/ilmora?schema=public',
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
})
