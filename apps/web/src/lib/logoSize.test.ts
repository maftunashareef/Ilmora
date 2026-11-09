import { describe, expect, it } from 'vitest'
import { balancedLogoSize } from './logoSize'

describe('balancedLogoSize', () => {
  it('gives a square emblem the full height', () => {
    expect(balancedLogoSize(1, 80, 300)).toEqual({ width: 80, height: 80 })
  })

  it('makes a wide word mark lower but wider, keeping its proportions', () => {
    const { width, height } = balancedLogoSize(6.8, 80, 400)
    expect(height).toBeLessThan(40)
    expect(width).toBeGreaterThan(200)
    expect(Math.abs(width / height - 6.8)).toBeLessThan(0.2)
  })

  it('never goes wider than the room it has', () => {
    const { width, height } = balancedLogoSize(6.8, 120, 240)
    expect(width).toBe(240)
    expect(Math.abs(width / height - 6.8)).toBeLessThan(0.2)
  })

  it('keeps a tall logo inside the height and falls back to a square for a broken size', () => {
    expect(balancedLogoSize(0.5, 80, 300)).toEqual({ width: 40, height: 80 })
    expect(balancedLogoSize(Number.NaN, 64, 300)).toEqual({ width: 64, height: 64 })
  })
})
