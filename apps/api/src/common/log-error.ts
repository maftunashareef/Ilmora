import { Prisma } from '../generated/prisma/client'

/**
 * What an unexpected error leaves in the server log (проверка безопасности 19.11, №8). Prisma errors carry values from
 * the query in `message` and `meta` — a phone, a name, a tax id, whatever broke a unique key — and the stack repeats the
 * message: for them the log gets the code and the model only. Any other error stays as it is, with its stack.
 */
export function logError(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const model = typeof err.meta?.modelName === 'string' ? err.meta.modelName : undefined
    return { type: err.name, prisma: err.code, model }
  }
  if (
    err instanceof Prisma.PrismaClientValidationError ||
    err instanceof Prisma.PrismaClientUnknownRequestError ||
    err instanceof Prisma.PrismaClientRustPanicError ||
    err instanceof Prisma.PrismaClientInitializationError
  ) {
    const code = (err as { errorCode?: unknown }).errorCode
    return { type: err.name, prisma: typeof code === 'string' ? code : undefined }
  }
  return err
}
