import { Injectable, type PipeTransform } from '@nestjs/common'
import type { ZodType } from 'zod'
import { AppError } from './errors'

/** Validates request bodies against a zod schema (unknown keys are rejected by the strict schemas in manage.schemas). */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value)
    if (!parsed.success) {
      throw AppError.invalid('validation_failed', 'Validation failed', { issues: parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })) })
    }
    return parsed.data
  }
}
