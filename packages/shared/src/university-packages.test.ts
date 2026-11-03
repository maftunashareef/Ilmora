import { describe, expect, it } from 'vitest'
import { isSafeExternalUrl } from './catalog.js'
import { presetMissingSubjects, presetPublishability, presetTotal, presetCourses, universityDirections, type PresetCourse } from './presets.js'
import * as sampleData from './sample-data.js'
import type { Preset } from './types.js'
import { UNIVERSITIES, UNIVERSITY_PACKAGES } from './university-packages.js'

/** The ILMORA offline courses a subject may be mapped to (sample catalog ids; resolved by id or slug at import time). */
const OFFLINE: PresetCourse[] = sampleData.courses.map((c) => ({ id: c.id, status: c.status, visibility: c.visibility, groups: c.groups.map((g) => ({ id: g.id })) }))
const OFFLINE_IDS = new Set(OFFLINE.map((c) => c.id))
const DATE = /^\d{4}-\d{2}-\d{2}$/
const LANGS = ['uz', 'ru', 'en'] as const

const toPreset = (seed: (typeof UNIVERSITY_PACKAGES)[number]): Preset => ({
  id: seed.id, universityId: seed.universityId, program: seed.program, name: seed.name, description: seed.description, enabled: false,
  slots: seed.subjects.map((s, i) => ({ id: `${seed.id}-s${i + 1}`, label: s.label, courseId: s.course })),
  admission: { ...seed.admission },
})

describe('researched university packages', () => {
  it('have unique ids, and every package belongs to a listed university', () => {
    const uniIds = UNIVERSITIES.map((u) => u.id)
    expect(new Set(uniIds).size).toBe(uniIds.length)
    const ids = UNIVERSITY_PACKAGES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of UNIVERSITY_PACKAGES) expect(uniIds, p.id).toContain(p.universityId)
  })

  it('give every university a name, a city and an https website', () => {
    for (const u of UNIVERSITIES) {
      expect(u.name.trim(), u.id).not.toBe('')
      expect(u.city?.trim(), u.id).toBeTruthy()
      expect(isSafeExternalUrl(u.website), u.id).toBe(true)
    }
  })

  it('name, describe and label everything in Uzbek, Russian and English', () => {
    for (const p of UNIVERSITY_PACKAGES) {
      for (const lang of LANGS) {
        expect(p.name[lang].trim(), `${p.id} name ${lang}`).not.toBe('')
        expect(p.program[lang].trim(), `${p.id} program ${lang}`).not.toBe('')
        expect(p.description[lang].trim(), `${p.id} description ${lang}`).not.toBe('')
        for (const s of p.subjects) expect(s.label[lang].trim(), `${p.id} subject ${lang}`).not.toBe('')
      }
      expect(p.subjects.length, p.id).toBeGreaterThan(0)
    }
  })

  it('record an official https source and the date it was checked for every package', () => {
    for (const p of UNIVERSITY_PACKAGES) {
      expect(isSafeExternalUrl(p.admission.url), `${p.id} url`).toBe(true)
      expect(p.admission.checkedOn, `${p.id} checkedOn`).toMatch(DATE)
      expect(p.admission.note.trim(), `${p.id} note`).not.toBe('')
    }
  })

  it('call a package verified only when it also states the academic year', () => {
    for (const p of UNIVERSITY_PACKAGES) {
      if (p.admission.status === 'verified') expect(p.admission.academicYear.trim(), p.id).not.toBe('')
      expect(['verified', 'needs_review'], p.id).toContain(p.admission.status)
    }
  })

  it('map subjects only to existing ILMORA offline courses, and never invent one', () => {
    for (const p of UNIVERSITY_PACKAGES) for (const s of p.subjects) if (s.course) expect(OFFLINE_IDS.has(s.course), `${p.id}: ${s.course}`).toBe(true)
  })

  it('never lists the same course twice in one package', () => {
    for (const p of UNIVERSITY_PACKAGES) {
      const ids = p.subjects.map((s) => s.course).filter(Boolean)
      // two subjects may legitimately share a course (e.g. English and IELTS); a package then still holds it once
      expect(new Set(ids).size, p.id).toBe(ids.length)
    }
  })

  it('can be published only when every subject has a course and the requirement is verified', () => {
    for (const p of UNIVERSITY_PACKAGES) {
      const preset = toPreset(p)
      const missing = presetMissingSubjects(preset)
      const result = presetPublishability(preset, OFFLINE)
      expect(result.ok, p.id).toBe(missing.length === 0 && p.admission.status === 'verified')
    }
  })

  it('has published candidates, and drafts that are reported rather than filled in with made-up courses', () => {
    const publishable = UNIVERSITY_PACKAGES.filter((p) => presetPublishability(toPreset(p), OFFLINE).ok)
    const drafts = UNIVERSITY_PACKAGES.filter((p) => !presetPublishability(toPreset(p), OFFLINE).ok)
    expect(publishable.length).toBeGreaterThan(0)
    expect(drafts.length).toBeGreaterThan(0)
    // every unpublishable package is explained by a missing course or an unverified source
    for (const p of drafts) expect(p.subjects.some((s) => s.course === null) || p.admission.status !== 'verified', p.id).toBe(true)
  })

  it('totals a publishable package from its courses’ own prices only (no package discount of its own)', () => {
    for (const p of UNIVERSITY_PACKAGES) {
      const preset = toPreset(p)
      if (!presetPublishability(preset, OFFLINE).ok) continue
      const courses = presetCourses(preset, sampleData.courses)
      const listed = courses.reduce((sum, c) => sum + c.price, 0)
      expect(presetTotal(courses), p.id).toBeGreaterThan(0)
      expect(presetTotal(courses), p.id).toBeLessThanOrEqual(listed)
    }
  })

  it('never claim an affiliation with the university', () => {
    for (const p of UNIVERSITY_PACKAGES) {
      expect(p.description.en, p.id).toMatch(/not officially affiliated/i)
      expect(p.description.ru, p.id).toMatch(/официально не связан/)
      expect(p.description.uz, p.id).toMatch(/rasmiy boğliq emas/)
    }
  })
})

describe('faculties, directions and the INHA and Narxoz data', () => {
  const directionsOf = (universityId: string) => universityDirections(UNIVERSITIES.find((u) => u.id === universityId) ?? { faculties: [] }).map((d) => d.direction.id)

  it('points every package only at directions its own university has, with unique direction ids', () => {
    const all = UNIVERSITIES.flatMap((u) => directionsOf(u.id))
    expect(new Set(all).size).toBe(all.length)
    for (const p of UNIVERSITY_PACKAGES) for (const d of p.directionIds ?? []) expect(directionsOf(p.universityId), `${p.id} → ${d}`).toContain(d)
  })

  it('separates INHA Business Administration and Logistics Management as directions served by one package', () => {
    expect(directionsOf('uni-inha')).toEqual(expect.arrayContaining(['inha-socie-cse-ice', 'inha-sbl-ba', 'inha-sbl-lm']))
    const sbl = UNIVERSITY_PACKAGES.filter((p) => p.directionIds?.includes('inha-sbl-ba'))
    expect(sbl.map((p) => p.id)).toEqual(['uni-inha-business'])
    expect(sbl[0].directionIds).toEqual(['inha-sbl-ba', 'inha-sbl-lm'])
  })

  it('offers IELTS at INHA as an optional extra next to the verified exam subjects', () => {
    const socie = UNIVERSITY_PACKAGES.find((p) => p.id === 'uni-inha-socie')!
    expect(socie.subjects.filter((s) => !s.optional).map((s) => s.label.en)).toEqual(['Mathematics', 'Physics'])
    expect(socie.subjects.filter((s) => s.optional).map((s) => s.course)).toEqual(['c-ielts'])
    expect(socie.admission).toMatchObject({ status: 'verified', academicYear: '2026-2027', checkedOn: '2026-11-03' })
    const business = UNIVERSITY_PACKAGES.find((p) => p.id === 'uni-inha-business')!
    expect(business.subjects.filter((s) => !s.optional).map((s) => s.label.en)).toEqual(['Mathematics'])
  })

  it('keeps every Narxoz pair an unverified draft: one package per pair, never one universal package', () => {
    const narxoz = UNIVERSITY_PACKAGES.filter((p) => p.universityId === 'uni-narxoz')
    expect(narxoz).toHaveLength(6)
    for (const p of narxoz) {
      expect(p.admission.status, p.id).toBe('needs_review')
      expect(p.subjects, p.id).toHaveLength(2)
      expect(p.directionIds, p.id).toHaveLength(1)
      expect(presetPublishability(toPreset(p), OFFLINE).ok, p.id).toBe(false)
    }
  })
})

describe('the seven universities of the preparation catalogue', () => {
  const ids = ['uni-inha', 'uni-narxoz', 'uni-tuit', 'uni-kiut', 'uni-mdis', 'uni-millat-umidi', 'uni-wiut']
  const packagesOf = (id: string) => UNIVERSITY_PACKAGES.filter((p) => p.universityId === id)

  it('each has its official name and an https website on its own domain', () => {
    for (const id of ids) {
      const u = UNIVERSITIES.find((x) => x.id === id)
      expect(u, id).toBeDefined()
      expect(u!.website && isSafeExternalUrl(u!.website), id).toBe(true)
      expect(u!.country, id).toBeTruthy()
    }
  })

  it('publishes only what an official 2026 page states: INHA and WIUT verified, the others to be verified', () => {
    for (const id of ['uni-inha', 'uni-wiut']) for (const p of packagesOf(id)) expect(p.admission, p.id).toMatchObject({ status: 'verified', academicYear: '2026-2027' })
    for (const id of ['uni-narxoz', 'uni-tuit', 'uni-kiut', 'uni-mdis']) {
      expect(packagesOf(id).length, id).toBeGreaterThan(0)
      for (const p of packagesOf(id)) expect(presetPublishability(toPreset(p), OFFLINE).ok, p.id).toBe(false)
    }
    expect(packagesOf('uni-millat-umidi')).toEqual([]) // nothing could be read on its official site
  })

  it('maps WIUT programmes to packages by their stated requirements, and leaves Business Information Systems without one', () => {
    const served = (dir: string) => UNIVERSITY_PACKAGES.filter((p) => p.directionIds?.includes(dir)).map((p) => p.id)
    expect(served('wiut-cs')).toEqual(['uni-wiut-cs'])
    expect(served('wiut-finance')).toEqual(['uni-wiut-business'])
    expect(served('wiut-commercial-law')).toEqual(['uni-wiut-law'])
    expect(served('wiut-bis')).toEqual([])
    const law = UNIVERSITY_PACKAGES.find((p) => p.id === 'uni-wiut-law')!
    expect(law.subjects.map((s) => !!s.optional)).toEqual([false]) // English is its only requirement
  })
})
