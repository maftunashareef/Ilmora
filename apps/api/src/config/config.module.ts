import { Global, Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { resolve } from 'node:path'
import { ENV, validateEnv, type Env } from './env'

/**
 * The config as validated from .env files + process.env. Nest copies only strings, numbers and booleans back into
 * process.env, so a list such as CORS_ORIGINS read from .env (the README way to start) was lost when ENV re-read
 * process.env — the API then started with no allowed origins (security review 10.11 №59). ENV now uses this.
 */
let validated: Env | undefined

/**
 * Loads .env (development) and validates process.env once. Other modules inject the
 * typed `Env` object through the ENV token instead of reading process.env directly.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: false,
      // apps/api/.env* regardless of the working directory (dist/ and src/ are one level below the app root)
      envFilePath: [resolve(__dirname, '..', '..', '.env.local'), resolve(__dirname, '..', '..', '.env'), '.env.local', '.env'],
      validate: (config) => (validated = validateEnv(config)),
    }),
  ],
  providers: [
    {
      provide: ENV,
      useFactory: (): Env => validated ?? validateEnv(process.env as Record<string, unknown>),
    },
  ],
  exports: [ENV],
})
export class AppConfigModule {}
