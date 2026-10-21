import { BullModule, getQueueToken } from '@nestjs/bullmq'
import { type DynamicModule, Module } from '@nestjs/common'
import { EventEmitter } from 'node:events'
import { QUEUES, type QueueName } from './queues'

export const REDIS_OFF = process.env.REDIS_MODE === 'off'

/**
 * Development-only inline queue: `add()` emits the job on a process-local bus that the producing module
 * handles immediately. Keeps the same injection tokens as BullMQ so services are unchanged.
 * Never used when REDIS_MODE=redis (the default, and the only mode allowed in production).
 */
export const inlineJobs = new EventEmitter()

class InlineQueue {
  constructor(readonly name: QueueName) {}
  async add(jobName: string, data: unknown, opts?: { jobId?: string }) {
    const id = opts?.jobId ?? `${this.name}-${Date.now()}`
    setImmediate(() => inlineJobs.emit(`${this.name}:${jobName}`, data, id))
    return { id, name: jobName, data }
  }
  async upsertJobScheduler() { return undefined }
  async getJobCounts() { return { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 } }
  async getFailed() { return [] as never[] }
  async getJob() { return null }
}

const ALL = Object.values(QUEUES) as QueueName[]

/** Registers every queue once; feature modules import this instead of BullModule.registerQueue. */
@Module({})
export class QueueModule {
  static forFeature(): DynamicModule {
    if (REDIS_OFF) {
      const providers = ALL.map((name) => ({ provide: getQueueToken(name), useValue: new InlineQueue(name) }))
      return { module: QueueModule, providers, exports: providers.map((p) => p.provide) }
    }
    const bull = BullModule.registerQueue(...ALL.map((name) => ({ name })))
    return { module: QueueModule, imports: [bull], exports: [bull] }
  }
}
