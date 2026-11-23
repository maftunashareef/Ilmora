import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common'
import type { Request, Response } from 'express'
import { Prisma } from '../../generated/prisma/client'
import { AppError } from '../errors'
import { logError } from '../log-error'
import { logPath } from '../log-path'

interface ErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string }
}

/**
 * Single error shape for every response. Internal details never leak: unexpected errors become a
 * generic 500 with the request id for correlation. The log gets the error with its stack; a Prisma error — its code
 * and model only, never the query's values (logError).
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const res = ctx.getResponse<Response>()
    const req = ctx.getRequest<Request & { id?: unknown }>()
    const requestId = req.id !== undefined ? String(req.id) : (req.headers['x-request-id'] as string | undefined)
    const { status, body } = this.describe(exception, requestId)

    // The path as the request log has it: no query string, the center's QR code masked (security review 19.11, №8, №11).
    // The error: a Prisma one by its code and model only, any other with its stack (№8, logError).
    if (status >= 500) this.logger.error({ err: logError(exception), requestId, path: logPath(req.originalUrl) }, 'Unhandled error')
    else if (status === 429) {
      // The real wait: the error's own, or what the throttler already put on the response (its block, e.g. 5 minutes
      // after too many sign-ins — №75: the answer used to promise «60 s»); 60 only when nothing says.
      const fromThrottler = Object.entries(res.getHeaders())
        .filter(([k]) => k.toLowerCase().startsWith('retry-after'))
        .map(([, v]) => Number(v))
        .filter((n) => Number.isFinite(n) && n > 0)
      const seconds = (body.error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds ?? (fromThrottler.length ? Math.max(...fromThrottler) : 60)
      res.setHeader('Retry-After', String(seconds))
      body.error.details = { ...((body.error.details as object | undefined) ?? {}), retryAfterSeconds: seconds }
    }

    res.status(status).json(body)
  }

  private describe(exception: unknown, requestId?: string): { status: number; body: ErrorBody } {
    if (exception instanceof AppError) {
      return { status: exception.getStatus(), body: { error: { code: exception.code, message: exception.message, details: exception.details, requestId } } }
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const payload = exception.getResponse()
      // class-validator errors arrive as { message: string[] }
      if (typeof payload === 'object' && payload && Array.isArray((payload as { message?: unknown }).message)) {
        return { status, body: { error: { code: 'validation_failed', message: 'Validation failed', details: (payload as { message: string[] }).message, requestId } } }
      }
      const message = typeof payload === 'string' ? payload : ((payload as { message?: string }).message ?? exception.message)
      const code = status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 404 ? 'not_found' : status === 429 ? 'rate_limited' : `http_${status}`
      return { status, body: { error: { code, message, requestId } } }
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') return { status: HttpStatus.CONFLICT, body: { error: { code: 'conflict', message: 'A record with the same unique value already exists', requestId } } }
      if (exception.code === 'P2025') return { status: HttpStatus.NOT_FOUND, body: { error: { code: 'not_found', message: 'Record not found', requestId } } }
      // A NUL character («%00») in an id, a search or a name: PostgreSQL text cannot hold it — the input is wrong, not the server.
      if (exception.code === 'P2039') return { status: HttpStatus.BAD_REQUEST, body: { error: { code: 'validation_failed', message: 'Text must not contain the NUL character', requestId } } }
    }
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: { error: { code: 'internal_error', message: 'Internal server error', requestId } } }
  }
}
