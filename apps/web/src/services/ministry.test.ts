import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StatsTableDto } from '@ilmora/shared'

const calls: { path: string; opts?: Record<string, unknown> }[] = []
vi.mock('../lib/api', () => ({
  api: vi.fn(async (path: string, opts?: Record<string, unknown>) => {
    calls.push({ path, opts })
    return {}
  }),
}))

const { cellText, columnTotal, exportFileName, filterYears, formatCount, ministry, NO_FIGURES_FILTER, queryOf } = await import('./ministry')

describe('ministry workspace calls', () => {
  beforeEach(() => { calls.length = 0 })

  it('asks for the figures without empty filters', async () => {
    await ministry.stats(NO_FIGURES_FILTER)
    await ministry.stats({ regionId: 'tashkent-city', type: 'TECHNIKUM', ownership: '', year: '2027' })
    expect(calls.map((c) => c.path)).toEqual(['/ministry/stats', '/ministry/stats?regionId=tashkent-city&type=TECHNIKUM&year=2027'])
  })

  it('downloads one table as a file, in the reader’s language and with the same filters', async () => {
    await ministry.exportTable('demand_supply', 'uz', { regionId: '', type: '', ownership: 'STATE', year: '' })
    expect(calls[0].path).toBe('/ministry/export?table=demand_supply&lang=uz&ownership=STATE')
    expect(calls[0].opts).toMatchObject({ responseType: 'blob' })
  })

  it('lists institutions and companies with trimmed search text; page 1 is left out', async () => {
    await ministry.institutions({ q: '  texnikum ', type: '', ownership: 'PRIVATE', regionId: '', industryId: 'it', status: 'approved', page: 1 })
    await ministry.institutions({ q: '', type: 'COLLEGE', ownership: '', regionId: 'r1', industryId: '', status: '', page: 3 })
    await ministry.companies({ q: '', industryId: '', regionId: '', status: 'pending', page: 2 })
    await ministry.institution('a/b')
    expect(calls.map((c) => c.path)).toEqual([
      '/ministry/institutions?q=texnikum&ownership=PRIVATE&industryId=it&status=approved',
      '/ministry/institutions?type=COLLEGE&regionId=r1&page=3',
      '/ministry/companies?status=pending&page=2',
      '/ministry/institutions/a%2Fb',
    ])
  })

  it('builds no query string when nothing is set', () => {
    expect(queryOf({ q: ' ', page: 1, x: null })).toBe('')
  })
})

describe('figures as text', () => {
  const table: StatsTableDto = {
    key: 'institutions_by_region',
    title: { uz: 'Hududlar', ru: 'Регионы', en: 'Regions' },
    columns: [
      { key: 'region', label: { uz: 'Hudud', ru: 'Регион', en: 'Region' }, numeric: false },
      { key: 'students', label: { uz: 'Talabalar', ru: 'Студентов', en: 'Students' }, numeric: true },
      { key: 'coverage', label: { uz: 'Qamrov, %', ru: 'Охват, %', en: 'Coverage, %' }, numeric: true },
    ],
    rows: [
      { region: { uz: 'Toşkent', ru: 'Ташкент', en: 'Tashkent' }, students: 12500, coverage: 42.5 },
      { region: { uz: 'Andijon', ru: 'Андижан', en: 'Andijan' }, students: 800, coverage: 10 },
    ],
  }

  it('groups thousands and writes the decimal sign of the language', () => {
    expect(formatCount(1234567, 'ru')).toBe('1 234 567')
    expect(formatCount(42.5, 'uz')).toBe('42,5')
    expect(formatCount(42.5, 'en')).toBe('42.5')
    expect(formatCount(-3, 'ru')).toBe('−3')
  })

  it('shows names in the reader’s language and a dash for nothing', () => {
    expect(cellText(table.rows[0].region, 'en')).toBe('Tashkent')
    expect(cellText(table.rows[0].students, 'ru')).toBe('12 500')
    expect(cellText(null, 'ru')).toBe('—')
  })

  it('sums counts but not percentages or years', () => {
    expect(columnTotal(table, 'students')).toBe(13300)
    expect(columnTotal(table, 'coverage')).toBeNull()
    expect(columnTotal(table, 'year')).toBeNull()
  })

  it('names the file like the API and offers years around now', () => {
    expect(exportFileName('coverage', new Date('2026-11-11T09:00:00Z'))).toBe('ilmora-coverage-2026-11-11.xlsx')
    expect(filterYears(new Date('2026-11-11'))).toEqual([2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030])
  })
})
