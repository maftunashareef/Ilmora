import { Global, Module } from '@nestjs/common'
import { PrivateDocsService } from './private-docs.service'

/** Object storage for private documents (the `ilmora-docs` bucket). */
@Global()
@Module({ providers: [PrivateDocsService], exports: [PrivateDocsService] })
export class StorageModule {}
