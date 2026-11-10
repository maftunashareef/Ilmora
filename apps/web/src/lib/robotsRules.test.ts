import { describe, expect, it } from 'vitest'
import { isDisallowed, ruleMatches } from './robotsRules'

describe('robots.txt rules', () => {
  it('leaves every public page open to crawlers', () => {
    for (const l of ['uz', 'ru', 'en']) {
      for (const p of ['', '/courses', '/courses/bazis', '/teachers', '/teachers/aziz-karimov', '/centers', '/centers/c1', '/universities', '/universities/u1', '/builder', '/course-finder', '/how-it-works', '/faq', '/oferta', '/privacy', '/videos/v1', '/playlists/p1', '/resources/r1']) {
        expect(isDisallowed(`/${l}${p}`), `/${l}${p}`).toBe(false)
      }
    }
  })

  it('closes the workspaces and the personal pages', () => {
    for (const p of ['/uz/admin', '/uz/admin/finance', '/ru/teacher', '/ru/teacher/groups/g1', '/en/center', '/en/center/students', '/uz/student', '/uz/student/profile', '/uz/login', '/uz/login?next=/uz/student', '/ru/preview', '/uz/favorites', '/uz/attend/s1', '/uz/attend/c/ABC', '/uz/payments/p1/return', '/uz/auth/google/callback', '/api/health', '/v1/public/catalog']) {
      expect(isDisallowed(p), p).toBe(true)
    }
  })

  it('matches the way crawlers do', () => {
    expect(ruleMatches('/uz/teacher', '/uz/teachers')).toBe(true)
    expect(ruleMatches('/uz/teacher$', '/uz/teachers')).toBe(false)
    expect(ruleMatches('/uz/teacher$', '/uz/teacher')).toBe(true)
    expect(ruleMatches('/*/admin', '/uz/admin/x')).toBe(true)
  })
})
