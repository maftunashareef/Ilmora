import { Module } from '@nestjs/common'
import { RegistryController } from './registry.controller'
import { RegistryService } from './registry.service'

/** Registry reference data: industries, regions, districts, directions, institution search (docs/registry/data-model.md). */
@Module({
  controllers: [RegistryController],
  providers: [RegistryService],
  exports: [RegistryService],
})
export class RegistryModule {}
