import type { NestExpressApplication } from '@nestjs/platform-express'

/**
 * Request bodies the API reads. The default JSON limit (100 kB) is too small for the site configuration once it holds
 * the university packages (one PUT carries every package, in three languages); useBodyParser replaces Nest's default
 * JSON parser and keeps rawBody for the payment webhooks. Payme sends its JSON-RPC calls as `text/json`: without it the
 * body arrives empty and every call fails (test/body-parsing.test.ts).
 */
export const JSON_BODY = { limit: '1mb', type: ['application/json', 'text/json'] }

export function configureBodyParsing(app: NestExpressApplication) {
  app.useBodyParser('json', JSON_BODY)
}
