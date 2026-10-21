import './instrument'
import { NestFactory } from '@nestjs/core'
import { Logger } from 'nestjs-pino'
import { WorkerAppModule } from './worker.module'

;(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function toJSON(this: bigint) {
  return this.toString()
}

/** Queue worker process: no HTTP listener, only BullMQ processors and the outbox dispatcher. */
async function bootstrap() {
  process.env.APP_ROLE = 'worker'
  const app = await NestFactory.createApplicationContext(WorkerAppModule, { bufferLogs: true })
  app.useLogger(app.get(Logger))
  app.enableShutdownHooks()
  app.get(Logger).log('ILMORA worker started')
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal worker startup error', err)
  process.exit(1)
})
