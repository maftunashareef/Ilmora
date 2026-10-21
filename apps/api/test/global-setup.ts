import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'

/** Applies migrations to the test database once per run (only when a database is configured). */
export default function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
  if (!url) {
    console.log('[tests] TEST_DATABASE_URL not set: database-backed suites are skipped')
    return
  }
  // Run the Prisma CLI entry point with the current Node binary and a fixed argument list (no shell).
  const prismaCli = createRequire(join(process.cwd(), 'package.json')).resolve('prisma/build/index.js')
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url, DATABASE_MIGRATE_URL: url } })
}
