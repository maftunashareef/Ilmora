import type { NestExpressApplication } from '@nestjs/platform-express'
import { paymeBodyErrorHandler } from './modules/payments/payme/payme.controller'

/**
 * JSON body parsing for the whole API, shared by main.ts and the HTTP tests so both parse requests the same way.
 * - The default JSON limit (100 kB) is too small for the site configuration once it holds the university packages (one
 *   PUT carries every package, in three languages). useBodyParser replaces Nest's default JSON parser and keeps rawBody
 *   for the payment webhooks; request validation and rate limits are unchanged.
 * - Payme sends its JSON-RPC calls as text/json; without it the body arrives empty.
 * - A Payme call whose body is not valid JSON is answered with JSON-RPC -32700 over HTTP 200, not with a 400.
 * The error handler must come after the parser: useBodyParser registers the parser at once, so the order holds.
 */
export function useBodyParsing(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: '1mb', type: ['application/json', 'text/json'] })
  app.use('/payments/payme', paymeBodyErrorHandler)
}
