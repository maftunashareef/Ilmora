import { Module } from '@nestjs/common'
import { RegistryController } from './registry.controller'
import { MemoryRegistryStore } from './registry.memory-store'
import { RegistryService } from './registry.service'
import { REGISTRY_STORE } from './registry.store'

/**
 * Registry reference data: industries, regions, directions, institution search.
 * STUB: `MemoryRegistryStore` until the data engineer's migration; then `useClass: PrismaRegistryStore` here.
 */
@Module({
  controllers: [RegistryController],
  providers: [RegistryService, { provide: REGISTRY_STORE, useClass: MemoryRegistryStore }],
  exports: [RegistryService],
})
export class RegistryModule {}
