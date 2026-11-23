import type { NestExpressApplication } from '@nestjs/platform-express'
import { paymeBodyErrorHandler } from './modules/payments/payme/payme.controller'

/**
 * Request bodies the API reads, shared by main.ts and the HTTP tests so both parse requests the same way.
 * - The default JSON limit (100 kB) is too small for the site configuration once it holds the university packages (one
 *   PUT carries every package, in three languages); useBodyParser replaces Nest's default JSON parser and keeps rawBody
 *   for the payment webhooks.
 * - Payme sends its JSON-RPC calls as `text/json`: without it the body arrives empty and every call fails
 *   (test/body-parsing.test.ts).
 * - A Payme call whose body is not valid JSON is answered with JSON-RPC -32700 over HTTP 200, not with a 400 (Payme reads
 *   any non-200 as -32400). The error handler must come after the parser: useBodyParser registers it at once.
 */
export const JSON_BODY = { limit: '1mb', type: ['application/json', 'text/json'] }
/** Click sends Prepare/Complete as a form (application/x-www-form-urlencoded): flat string fields only. */
export const FORM_BODY = { limit: '20kb', extended: false }

export function configureBodyParsing(app: NestExpressApplication) {
  app.useBodyParser('json', JSON_BODY)
  app.use('/payments/payme', paymeBodyErrorHandler)
  app.useBodyParser('urlencoded', FORM_BODY)
}
