import 'reflect-metadata'
import { Module, type INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { configureBodyParsing } from '../src/body-parsing'
import { ENV } from '../src/config/env'
import { PrismaService } from '../src/infra/prisma/prisma.service'
import { PaymeController } from '../src/modules/payments/payme/payme.controller'
import { PaymeService } from '../src/modules/payments/payme/payme.service'
import { testEnv } from './helpers'

/**
 * Payme calls the API with `Content-Type: text/json` (security review 10.11 №41, earlier Н9). The real Payme endpoint
 * runs with the body parsing main.ts uses; Payme's own logic is replaced by an echo of what reached it.
 */
describe('Payme requests sent as text/json', () => {
  let app: INestApplication | undefined
  afterEach(async () => { await app?.close(); app = undefined })

  const start = async (withParsing: boolean) => {
    const payme = { authenticate: () => ({ sandbox: false }), handle: async (method: string, params: object) => ({ method, params }) }
    const prisma = { client: { payment: { findFirst: async () => null }, paymentTransaction: { findUnique: async () => null }, providerCallbackLog: { create: async () => ({}) } } }
    @Module({ controllers: [PaymeController], providers: [{ provide: PaymeService, useValue: payme }, { provide: PrismaService, useValue: prisma }, { provide: ENV, useValue: testEnv() }] })
    class PaymeOnlyModule {}
    const created = await NestFactory.create<NestExpressApplication>(PaymeOnlyModule, { logger: false, rawBody: true, bodyParser: withParsing ? undefined : false })
    if (withParsing) configureBodyParsing(created)
    await created.init()
    app = created
    return created
  }

  const call = (a: INestApplication, type: string) =>
    request(a.getHttpServer()).post('/payments/payme').set('Content-Type', type).set('Authorization', 'Basic eA==')
      .send(JSON.stringify({ method: 'CheckPerformTransaction', params: { amount: 100, account: { payment_id: 'pay-1' } }, id: 7 }))

  it('reads the body of a text/json call the same way as application/json', async () => {
    const a = await start(true)
    for (const type of ['text/json', 'text/json; charset=utf-8', 'application/json']) {
      const res = await call(a, type)
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ result: { method: 'CheckPerformTransaction', params: { amount: 100, account: { payment_id: 'pay-1' } } }, id: 7 })
    }
  })

  it('without that parsing the body is empty and Payme gets «invalid request» — what the test guards against', async () => {
    const res = await call(await start(false), 'text/json')
    expect(res.body).toMatchObject({ error: { code: -32600 }, id: null })
  })
})
