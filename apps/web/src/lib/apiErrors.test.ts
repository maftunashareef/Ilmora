import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { translate } from '@ilmora/shared'
import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { API_ERROR_KEYS, apiErrorText } from './apiErrors'

const API_SRC = join(__dirname, '..', '..', '..', 'api', 'src')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : sources(path)
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : []
  })
}

/** Every error code the API can answer with: explicit AppError codes plus the ones the helpers and the global filter use. */
function apiErrorCodes(): Set<string> {
  const codes = new Set(['not_found', 'forbidden', 'unauthorized', 'rate_limited', 'unavailable', 'validation_failed', 'conflict', 'internal_error'])
  for (const file of sources(API_SRC)) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/(?:new AppError|AppError\.(?:invalid|conflict))\(\s*'([^']+)'/g)) codes.add(m[1])
    for (const m of src.matchAll(/AppError\.unauthorized\(\s*'[^']*',\s*'([^']+)'/g)) codes.add(m[1])
  }
  return codes
}

describe('API error texts', () => {
  it('translate every error code the API can return', () => {
    const codes = apiErrorCodes()
    expect(codes.size).toBeGreaterThan(50)
    const missing = [...codes].filter((c) => c !== 'conflict' && !(c in API_ERROR_KEYS))
    expect(missing).toEqual([])
  })

  it('show the translated text in Uzbek and Russian, never the English API message', () => {
    const err = new ApiError(403, 'forbidden', 'Only the Super Admin can manage online courses')
    expect(apiErrorText(err, 'uz')).toBe(translate('uz', 'apiError.forbidden'))
    expect(apiErrorText(err, 'ru')).toBe(translate('ru', 'apiError.forbidden'))
    expect(apiErrorText(new ApiError(422, 'online_course_no_discount', 'Online courses are free and cannot have a discount'), 'uz')).toBe(translate('uz', 'apiError.onlineNoDiscount'))
  })

  it('keep the API’s own message in English', () => {
    expect(apiErrorText(new ApiError(403, 'forbidden', 'Only the Super Admin can manage online courses'), 'en')).toBe('Only the Super Admin can manage online courses')
  })

  it('translate the client’s network error in every language (its message is Uzbek)', () => {
    const err = new ApiError(0, 'network_error', 'Server bilan aloqa o‘rnatib bo‘lmadi')
    expect(apiErrorText(err, 'en')).toBe(translate('en', 'auth.err.network'))
    expect(apiErrorText(err, 'ru')).toBe(translate('ru', 'auth.err.network'))
  })

  it('tell a duplicate record apart from overlapping groups', () => {
    expect(apiErrorText(new ApiError(409, 'conflict', 'A record with the same unique value already exists'), 'uz')).toBe(translate('uz', 'apiError.duplicateRecord'))
    expect(apiErrorText(new ApiError(422, 'conflict', 'Two selected groups overlap in the weekly schedule'), 'uz')).toBe(translate('uz', 'builder.conflictHint'))
  })

  it('fall back to a generic text for unknown codes and non-API errors', () => {
    expect(apiErrorText(new ApiError(400, 'http_400', 'Bad Request'), 'uz')).toBe(translate('uz', 'apiError.generic'))
    expect(apiErrorText(new Error('boom'), 'ru')).toBe(translate('ru', 'apiError.generic'))
    expect(apiErrorText(new Error('boom'), 'en')).toBe('boom')
  })
})
