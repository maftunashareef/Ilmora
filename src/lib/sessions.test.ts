import { describe, expect, it } from 'vitest'
import { attendanceUrl, generateSessions, isPastSession, mergeSessions, sessionId } from './sessions'
import type { Group } from '../types'

// Mon/Wed 18:00–19:30
const group: Group = { id: 'g-test-a', courseId: 'c-test', name: 'A', days: [0, 2], start: '18:00', end: '19:30', room: '1', capacity: 10 }

describe('sessions', () => {
  it('expands the weekly schedule into one session per scheduled day with distinct tokens', () => {
    const from = new Date(2026, 9, 5) // Monday 5 Oct 2026
    const list = generateSessions(group, from, 14, new Date(2026, 9, 1))
    expect(list.map((s) => s.date)).toEqual(['2026-10-05', '2026-10-07', '2026-10-12', '2026-10-14'])
    expect(new Set(list.map((s) => s.token)).size).toBe(list.length)
    expect(list.every((s) => s.status === 'scheduled' && !s.attendanceOpen)).toBe(true)
    expect(list[0].id).toBe(sessionId('g-test-a', '2026-10-05'))
  })

  it('marks occurrences that already ended as completed', () => {
    const list = generateSessions(group, new Date(2026, 9, 5), 7, new Date(2026, 9, 6))
    expect(list.find((s) => s.date === '2026-10-05')?.status).toBe('completed')
    expect(list.find((s) => s.date === '2026-10-07')?.status).toBe('scheduled')
    expect(isPastSession(list[0], new Date(2026, 9, 6))).toBe(true)
  })

  it('merging keeps existing sessions (and their tokens) and only adds new ones', () => {
    const first = generateSessions(group, new Date(2026, 9, 5), 7)
    const again = generateSessions(group, new Date(2026, 9, 5), 14)
    const merged = mergeSessions(first, again)
    expect(merged).toHaveLength(4)
    expect(merged[0].token).toBe(first[0].token)
  })

  it('encodes the session id and token in a base-path aware attendance URL', () => {
    const [s] = generateSessions(group, new Date(2026, 9, 5), 7)
    const url = attendanceUrl(s, 'https://example.test')
    expect(url).toBe(`https://example.test/attend/${s.id}?t=${s.token}`)
  })
})
