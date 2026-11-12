import { HttpException, HttpStatus } from '@nestjs/common'

/**
 * Application error with a stable machine-readable code. The global filter turns it into
 * `{ error: { code, message, details?, requestId } }` with the matching HTTP status.
 */
export class AppError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status)
  }

  static notFound(what: string, details?: Record<string, unknown>) {
    return new AppError('not_found', `${what} not found`, HttpStatus.NOT_FOUND, details)
  }
  static forbidden(message = 'Forbidden', details?: Record<string, unknown>) {
    return new AppError('forbidden', message, HttpStatus.FORBIDDEN, details)
  }
  static unauthorized(message = 'Unauthorized', code = 'unauthorized') {
    return new AppError(code, message, HttpStatus.UNAUTHORIZED)
  }
  static conflict(code: string, message: string, details?: Record<string, unknown>) {
    return new AppError(code, message, HttpStatus.CONFLICT, details)
  }
  static invalid(code: string, message: string, details?: Record<string, unknown>) {
    return new AppError(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details)
  }
  static tooMany(message = 'Too many requests', retryAfterSeconds?: number) {
    return new AppError('rate_limited', message, HttpStatus.TOO_MANY_REQUESTS, retryAfterSeconds ? { retryAfterSeconds } : undefined)
  }
  static unavailable(message = 'Service temporarily unavailable') {
    return new AppError('unavailable', message, HttpStatus.SERVICE_UNAVAILABLE)
  }
}

/**
 * The unique constraint a P2002 hit, as text: its index name or fields. Prisma 7 with the PostgreSQL adapter puts it in
 * `meta.driverAdapterError.cause.constraint` and no longer fills `meta.target` (re-check 11.11 №35); both are read.
 * Empty when the error does not say.
 */
export function uniqueConstraintOf(err: unknown): string {
  const meta = (err as { meta?: { target?: unknown; driverAdapterError?: { cause?: { constraint?: { index?: string; fields?: string[] } } } } }).meta
  const constraint = meta?.driverAdapterError?.cause?.constraint
  return [meta?.target, constraint?.index, constraint?.fields].flat().filter((x) => typeof x === 'string').join(' ')
}
