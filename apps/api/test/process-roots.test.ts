import { Test } from '@nestjs/testing'
import { describe, it } from 'vitest'
import { AppModule } from '../src/app.module'
import { WorkerAppModule } from '../src/worker.module'
import { DB_AVAILABLE } from './helpers'

/**
 * Both process roots build every provider. A provider missing from one of them is not a type error: the process dies
 * on start and restarts in a loop. On 11.11 the worker did that for 14 hours (the outbox needed PrivateDocsService,
 * which only the API root imported) while the release's checks, which look at the API and the site, stayed green.
 */
describe.skipIf(!DB_AVAILABLE)('process roots', () => {
  it('the worker builds', async () => {
    const mod = await Test.createTestingModule({ imports: [WorkerAppModule] }).compile()
    await mod.close()
  })

  it('the API builds', async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    await mod.close()
  })
})
