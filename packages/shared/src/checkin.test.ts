import { describe, expect, it } from 'vitest'
import { checkInWindow, checkLocation, haversineMeters, requiresLocation } from './checkin.js'

const T = (iso: string) => new Date(iso)

describe('center QR check-in window', () => {
  const lesson = { startsAt: '2026-11-10T13:00:00.000Z', beforeMin: 15, afterMin: 20 }

  it('opens 15 minutes before the start and closes 20 minutes after it', () => {
    expect(checkInWindow(lesson, T('2026-11-10T12:44:59.000Z')).state).toBe('early')
    expect(checkInWindow(lesson, T('2026-11-10T12:45:00.000Z')).state).toBe('open')
    expect(checkInWindow(lesson, T('2026-11-10T13:20:00.000Z')).state).toBe('open')
    expect(checkInWindow(lesson, T('2026-11-10T13:20:01.000Z')).state).toBe('late')
  })

  it('reports the exact bounds and tolerates negative settings as zero', () => {
    const w = checkInWindow({ ...lesson, beforeMin: -5, afterMin: 0 }, T('2026-11-10T13:00:00.000Z'))
    expect(w.opensAt.toISOString()).toBe('2026-11-10T13:00:00.000Z')
    expect(w.closesAt.toISOString()).toBe('2026-11-10T13:00:00.000Z')
    expect(w.state).toBe('open')
  })
})

describe('location check', () => {
  // Tashkent: two points about 1.6 km apart.
  const center = { lat: 41.3111, lng: 69.2797, geoRadiusM: 300 }
  const onSite = { lat: 41.3118, lng: 69.2805 }
  const farAway = { lat: 41.2990, lng: 69.2700 }

  it('measures distances on the sphere', () => {
    expect(haversineMeters(center, center)).toBe(0)
    expect(haversineMeters(center, onSite)).toBeGreaterThan(80)
    expect(haversineMeters(center, onSite)).toBeLessThan(130)
    expect(haversineMeters(center, farAway)).toBeGreaterThan(1_400)
  })

  it('is skipped when the center has no location or radius', () => {
    expect(requiresLocation({ lat: null, lng: null, geoRadiusM: null })).toBe(false)
    expect(requiresLocation({ lat: 41.3, lng: 69.2, geoRadiusM: 0 })).toBe(false)
    expect(checkLocation({ lat: 41.3, lng: 69.2, geoRadiusM: null }, null)).toEqual({ result: 'not-required', distanceM: null })
  })

  it('requires coordinates and refuses a point outside the radius', () => {
    expect(checkLocation(center, null).result).toBe('location-required')
    expect(checkLocation(center, { lat: Number.NaN, lng: 1 }).result).toBe('location-required')
    expect(checkLocation(center, onSite).result).toBe('ok')
    expect(checkLocation(center, farAway).result).toBe('too-far')
  })

  it('allows the phone’s reported accuracy as slack, capped at the radius', () => {
    const edge = { lat: 41.3111, lng: 69.2797 + 0.0045 } // ≈ 375 m east
    expect(checkLocation(center, edge).result).toBe('too-far')
    expect(checkLocation(center, { ...edge, accuracyM: 100 }).result).toBe('ok')
    expect(checkLocation(center, { ...farAway, accuracyM: 100_000 }).result).toBe('too-far')
  })
})
