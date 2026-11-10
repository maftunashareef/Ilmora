import { describe, expect, it } from 'vitest'
import { sampleData } from '@ilmora/shared'
import type { InitialData } from './useStore'
import { createIlmoraStore, GUEST_STUDENT_ID } from './useStore'

const initialMock: InitialData = {
  lang: 'uz',
  site: Object.assign({}, sampleData.site, { version: 1 }) as never,
  catalog: {
    centers: sampleData.centers as never,
    categories: sampleData.categories as never,
    teachers: sampleData.teachers as never,
    subjects: sampleData.subjects as never,
    courses: sampleData.courses as never,
  },
}

describe('Web Auth Store tests', () => {
  it('initializes in visitor mode with guest student', () => {
    const store = createIlmoraStore(initialMock)
    const state = store.getState()

    expect(state.auth.status).toBe('idle')
    expect(state.auth.user).toBeNull()
    expect(state.role).toBe('visitor')
    expect(state.currentStudentId).toBe(GUEST_STUDENT_ID)
  })

  it('authenticates demo student and switches role to student', async () => {
    const store = createIlmoraStore(initialMock)
    await store.getState().loginAsDemo('STUDENT')

    const state = store.getState()
    expect(state.auth.status).toBe('authenticated')
    expect(state.role).toBe('student')
    expect(state.auth.user?.roles).toContain('STUDENT')
    expect(state.currentStudentId).toBe(state.auth.user?.id)
  })

  it('authenticates demo teacher and switches role to teacher', async () => {
    const store = createIlmoraStore(initialMock)
    await store.getState().loginAsDemo('TEACHER')

    const state = store.getState()
    expect(state.auth.status).toBe('authenticated')
    expect(state.role).toBe('teacher')
    expect(state.auth.user?.roles).toContain('TEACHER')
    expect(state.currentTeacherId).toBe(state.auth.user?.teacherProfileId)
  })

  it('logs out and restores visitor state', async () => {
    const store = createIlmoraStore(initialMock)
    await store.getState().loginAsDemo('STUDENT')
    expect(store.getState().role).toBe('student')

    await store.getState().logout()
    const state = store.getState()
    expect(state.auth.status).toBe('anonymous')
    expect(state.auth.user).toBeNull()
    expect(state.role).toBe('visitor')
    expect(state.currentStudentId).toBe(GUEST_STUDENT_ID)
  })
})
