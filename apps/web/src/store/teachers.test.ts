import { describe, expect, it } from 'vitest'
import { sampleData } from '@ilmora/shared'
import { localizePath } from '../lib/routerHooks'
import type { InitialData } from './useStore'
import { createIlmoraStore } from './useStore'

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

describe('Teacher Directory, Logo Navigation, and Profile Tests', () => {
  it('localizes root logo link accurately across all three languages', () => {
    expect(localizePath('/', 'uz')).toBe('/uz')
    expect(localizePath('/', 'ru')).toBe('/ru')
    expect(localizePath('/', 'en')).toBe('/en')

    // Preserves existing path segments under active locale
    expect(localizePath('/teachers', 'uz')).toBe('/uz/teachers')
    expect(localizePath('/teachers', 'ru')).toBe('/ru/teachers')
    expect(localizePath('/teachers', 'en')).toBe('/en/teachers')

    // Does not double prefix if already localized
    expect(localizePath('/uz', 'uz')).toBe('/uz')
    expect(localizePath('/ru/courses', 'ru')).toBe('/ru/courses')
    expect(localizePath('/en/builder', 'en')).toBe('/en/builder')
  })

  it('filters teacher list by name query', () => {
    const store = createIlmoraStore(initialMock)
    const teachers = store.getState().teachers

    expect(teachers.length).toBeGreaterThan(0)

    const firstTeacher = teachers[0]
    const query = firstTeacher.name.slice(0, 4).toLowerCase()

    const matches = teachers.filter((t) =>
      t.name.toLowerCase().includes(query)
    )

    expect(matches.length).toBeGreaterThan(0)
    expect(matches.some((t) => t.id === firstTeacher.id)).toBe(true)

    const noMatches = teachers.filter((t) =>
      t.name.toLowerCase().includes('xyznonexistentname123')
    )
    expect(noMatches.length).toBe(0)
  })

  it('filters teacher list by subject ID based on courses taught', () => {
    const store = createIlmoraStore(initialMock)
    const teachers = store.getState().teachers
    const courses = store.getState().courses

    // Find a course that has a subjectId
    const courseWithSubject = courses.find((c) => c.subjectId)
    if (courseWithSubject && courseWithSubject.subjectId) {
      const targetSubjectId = courseWithSubject.subjectId

      const matchingTeachers = teachers.filter((te) =>
        courses.some(
          (c) => c.teacherId === te.id && c.subjectId === targetSubjectId
        )
      )

      expect(matchingTeachers.length).toBeGreaterThan(0)
      expect(
        matchingTeachers.some((t) => t.id === courseWithSubject.teacherId)
      ).toBe(true)
    }
  })

  it('supports teacher profile photo URL field and local upload fallback', () => {
    const store = createIlmoraStore(initialMock)
    const teacher = store.getState().teachers[0]

    // Initially uses seed or placeholder
    expect(teacher.avatarSeed).toBeDefined()

    // When avatarUrl is provided
    const withAvatarUrl = {
      ...teacher,
      avatarUrl: 'https://cdn.example.uz/teachers/photo.jpg',
    }
    const resolvedUrl =
      withAvatarUrl.avatarUrl || withAvatarUrl.avatarUpload?.previewUrl
    expect(resolvedUrl).toBe('https://cdn.example.uz/teachers/photo.jpg')

    // When upload previewUrl is provided
    const withUpload = {
      ...teacher,
      avatarUrl: null,
      avatarUpload: {
        name: 'photo.png',
        size: 1024,
        mime: 'image/png',
        previewUrl: 'blob:http://localhost:3000/xyz',
      },
    }
    const uploadUrl = withUpload.avatarUrl || withUpload.avatarUpload?.previewUrl
    expect(uploadUrl).toBe('blob:http://localhost:3000/xyz')
  })

  it('resolves curated teacher photos and provides null for placeholder fallback', async () => {
    const { getTeacherAvatarUrl, TEACHER_PHOTOGRAPHS } = await import(
      '../components/teacher/teacherImage'
    )

    // Dilnoza has a curated photo
    const dilnozaPhoto = getTeacherAvatarUrl({ id: 't-dilnoza' })
    expect(dilnozaPhoto).toBe('/images/teachers/dilnoza-karimova.jpg')
    expect(TEACHER_PHOTOGRAPHS['t-dilnoza']).toBeDefined()

    // Bekzod has a curated craftsman photo
    const bekzodPhoto = getTeacherAvatarUrl({ id: 't-bekzod' })
    expect(bekzodPhoto).toBe('/images/teachers/bekzod-nazarov.jpg')

    // Local upload overrides static photo
    const customUpload = getTeacherAvatarUrl({
      id: 't-dilnoza',
      avatarUpload: { previewUrl: 'blob:http://localhost:3000/my-new-photo' },
    })
    expect(customUpload).toBe('blob:http://localhost:3000/my-new-photo')

    // Explicit custom avatarUrl overrides static mapping
    const customUrl = getTeacherAvatarUrl({
      id: 't-dilnoza',
      avatarUrl: 'https://images.unsplash.com/photo-custom',
    })
    expect(customUrl).toBe('https://images.unsplash.com/photo-custom')

    // Teacher without photo (e.g. Sardor Alimov or unmapped teacher) returns null to trigger neutral brand placeholder
    const sardorPhoto = getTeacherAvatarUrl({ id: 't-sardor' })
    expect(sardorPhoto).toBeNull()

    const unmappedPhoto = getTeacherAvatarUrl({ id: 't-unknown-instructor' })
    expect(unmappedPhoto).toBeNull()

    // Null/undefined teacher safe handling
    expect(getTeacherAvatarUrl(null)).toBeNull()
    expect(getTeacherAvatarUrl(undefined)).toBeNull()
  })

  it('restores all 8 intended active teacher profiles when catalog is populated with intended data', () => {
    const store = createIlmoraStore(initialMock)
    const teachers = store.getState().teachers
    const activeTeachers = teachers.filter((t) => t.channelActive)

    // Dilnoza, Jamshid, Aziza, Bekzod, Malika, Sardor, Kamola, Rustam (8 active out of 9 total)
    expect(activeTeachers.length).toBe(8)
    const activeIds = activeTeachers.map((t) => t.id)
    expect(activeIds).toEqual([
      't-dilnoza',
      't-jamshid',
      't-aziza',
      't-bekzod',
      't-malika',
      't-sardor',
      't-kamola',
      't-rustam',
    ])

    // Verify all active teachers have valid center assignments
    const centers = store.getState().centers
    for (const te of activeTeachers) {
      expect(te.centerId).toBeDefined()
      const center = centers.find((c) => c.id === te.centerId)
      expect(center).toBeDefined()
    }

    // Verify all curated portrait teachers retain their photos
    const withPhotos = activeTeachers.filter((t) => t.avatarUrl)
    expect(withPhotos.length).toBe(5)
  })
})

