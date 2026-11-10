import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { testEnv } from './helpers'

describe('Click is removed (decision 10.11, security review №5, №6)', () => {
  it('checkout takes Payme only; providers list Payme only; no Click routes or settings', async () => {
    const { validate } = await import('class-validator')
    const { plainToInstance } = await import('class-transformer')
    const { EnrollmentController } = await import('../src/modules/enrollment/enrollment.controller')
    const { PaymentsService } = await import('../src/modules/payments/payments.service')
    const { PaymentsModule } = await import('../src/modules/payments/payments.module')
    const types = Reflect.getMetadata('design:paramtypes', EnrollmentController.prototype, 'checkout') as (new () => object)[]
    const CheckoutDto = types[2]
    expect((await validate(plainToInstance(CheckoutDto, { provider: 'CLICK' }))).map((e) => e.property)).toEqual(['provider'])
    expect(await validate(plainToInstance(CheckoutDto, { provider: 'PAYME' }))).toEqual([])
    const env = testEnv({ PAYME_MERCHANT_ID: 'm', PAYME_TEST_KEY: 'k', CLICK_SERVICE_ID: '77', CLICK_MERCHANT_ID: '1', CLICK_SECRET_KEY: 's' })
    expect(new PaymentsService({} as never, {} as never, {} as never, {} as never, {} as never, env).providersAvailable()).toEqual({ PAYME: true })
    expect(Object.keys(env).filter((k) => k.startsWith('CLICK_'))).toEqual([])
    const controllers = (Reflect.getMetadata('controllers', PaymentsModule) as { name: string }[]).map((c) => c.name)
    expect(controllers).toEqual(['PaymentsController', 'PaymeController'])
  })
})
