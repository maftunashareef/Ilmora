import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common'
import type { Request, Response } from 'express'
import { Prisma } from '../../generated/prisma/client'
import { AppError } from '../errors'

interface ErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string }
}

/**
 * Single error shape for every response. Internal details never leak: unexpected errors become a
 * generic 500 with the request id for correlation (the full error goes to logs and Sentry).
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

    if (status >= 500) this.logger.error({ err: exception, requestId, path: req.originalUrl }, 'Unhandled error')
    else if (status === 429) res.setHeader('Retry-After', String((body.error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds ?? 60))

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
    }
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: { error: { code: 'internal_error', message: 'Internal server error', requestId } } }
  }
}
