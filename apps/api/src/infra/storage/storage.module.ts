import { Global, Module } from '@nestjs/common'
import { MediaSweepService } from './media-sweep.service'
import { PrivateDocsService } from './private-docs.service'

/** Object storage: private documents (the `ilmora-docs` bucket) and the sweep of abandoned media (`ilmora-media`). */
@Global()
@Module({ providers: [PrivateDocsService, MediaSweepService], exports: [PrivateDocsService, MediaSweepService] })
export class StorageModule {}
