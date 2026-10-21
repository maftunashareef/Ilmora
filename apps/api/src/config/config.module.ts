import { Global, Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { resolve } from 'node:path'
import { ENV, validateEnv, type Env } from './env'

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
      validate: (config) => validateEnv(config),
    }),
  ],
  providers: [
    {
      provide: ENV,
      useFactory: (): Env => validateEnv(process.env as Record<string, unknown>),
    },
  ],
  exports: [ENV],
})
export class AppConfigModule {}
