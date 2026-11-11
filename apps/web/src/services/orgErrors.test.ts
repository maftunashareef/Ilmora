import { describe, expect, it } from 'vitest'
import { ApiError } from '../lib/api'
import { orgErrorText } from './orgErrors'

describe('orgErrorText', () => {
  it('403 forbidden — the organization is blocked, not «no rights»', () => {
    expect(orgErrorText(new ApiError(403, 'forbidden', 'The company is blocked; write to support'), 'ru')).toBe('Организация заблокирована, напишите в поддержку.')
    expect(orgErrorText(new ApiError(403, 'forbidden', 'The institution is blocked; write to support'), 'en', 'submit')).toBe('The organization is blocked — write to support.')
  })

  it('429 names the hourly limit of the action', () => {
    expect(orgErrorText(new ApiError(429, 'rate_limited', 'Too many'), 'ru', 'save')).toBe('Сохранять можно не больше 30 раз в час. Повторите позже.')
    expect(orgErrorText(new ApiError(429, 'rate_limited', 'Too many'), 'ru', 'submit')).toBe('Отправлять на проверку можно не больше 10 раз в час. Повторите позже.')
    expect(orgErrorText(new ApiError(429, 'rate_limited', 'Too many'), 'uz', 'save')).toContain('30')
  })

  it('anything else — the usual text', () => {
    expect(orgErrorText(new ApiError(403, 'not_approved', 'not yet'), 'ru')).not.toContain('заблокирована')
    expect(orgErrorText(new ApiError(429, 'rate_limited', 'Too many'), 'ru')).toBe('Слишком много попыток. Попробуйте позже.')
  })
})
