import { useState } from 'react'
import { countLabel, isOnlineCourse, isPublicListed, newPreset, newUniversity, NOUNS, presetCourses, presetDurationMonths, presetMissingSubjects, presetPublishability, presetTotal, universityDirections, universityOf, type AdmissionStatus } from '@ilmora/shared'
import { FormatBadge, PriceNow, ScheduleChips } from '../../components/course/CourseCard'
import { Badge, Button, Card, cx, Eyebrow, Field, Icon, Input, LField, Notice, Select, Textarea } from '../../components/ui'
import { emptyL, useT } from '../../i18n/useT'
import type { TKey } from '../../i18n/translations'
import { formatSom } from '../../lib/format'
import { uid, useStore } from '../../store/useStore'
import type { Preset, University } from '../../types'
import { FacultiesEditor, LogoField } from './UniversityFaculties'

const MAX_SUBJECTS = 8
type StatusFilter = 'all' | 'draft' | 'published' | 'review'

/**
 * University preparation packages for the Super Admin: universities, their programs, the required subjects mapped to
 * existing offline courses, the official source of those requirements, and publishing. The price is never typed here:
 * it is always the sum of the current course prices. A package can be published only when every subject maps to an
 * available course and its admission requirements are verified (the server enforces the same rule).
 */
export function UniversityPackagesAdmin() {
  const { t, tr, lang } = useT()
  const presets = useStore((s) => s.site.presets)
  const universities = useStore((s) => s.site.universities)
  const loaded = useStore((s) => s.presetsLoaded)
  const courses = useStore((s) => s.courses)
  const centers = useStore((s) => s.centers)
  const categories = useStore((s) => s.categories)
  const patchSite = useStore((s) => s.patchSite)
  const [open, setOpen] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [uniFilter, setUniFilter] = useState('')
  const [editUnis, setEditUnis] = useState(false)
  const [openFaculties, setOpenFaculties] = useState<string | null>(null)

  const list = presets ?? []
  const unis = universities ?? []
  const usedDirectionIds = new Set(list.flatMap((p) => p.directionIds ?? []))
  const setPresets = (next: Preset[]) => patchSite((s) => ({ ...s, presets: next }))
  const setUnis = (next: University[]) => patchSite((s) => ({ ...s, universities: next }))
  const up = (id: string, patch: Partial<Preset>) => setPresets(list.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  const upAdmission = (p: Preset, patch: Partial<NonNullable<Preset['admission']>>) => up(p.id, { admission: { url: '', academicYear: '', checkedOn: '', status: 'needs_review', note: '', ...p.admission, ...patch } })
  // A package fills the cart with groups, so only offline courses can back a subject.
  const offline = courses.filter((c) => !isOnlineCourse(c)).sort((a, b) => tr(a.title).localeCompare(tr(b.title), lang))
  const centerName = (id: string) => centers.find((c) => c.id === id)?.name ?? ''
  const usedBy = (uniId: string) => list.filter((p) => p.universityId === uniId).length

  // The public site response hides drafts and unused universities, so editing waits for the full lists.
  if (!loaded) return <section className="mt-12"><Eyebrow>{t('admin.uni.title')}</Eyebrow><p className="mt-2 text-sm text-charcoal/55">{t('common.loading')}</p></section>

  const needsReview = (p: Preset) => (p.universityId || p.university) && p.admission?.status !== 'verified'
  const visible = list.filter((p) => {
    if (p.id === open) return true // the package being edited stays on screen even when the edit moves it out of the filter
    if (uniFilter && p.universityId !== uniFilter) return false
    if (status === 'draft') return !p.enabled
    if (status === 'published') return p.enabled
    if (status === 'review') return !!needsReview(p)
    return true
  })
  // Grouped by university, universities in the order they were added; packages without a university last.
  const groups: { key: string; uni?: University; items: Preset[] }[] = [
    ...unis.map((u) => ({ key: u.id, uni: u as University | undefined, items: visible.filter((p) => p.universityId === u.id) })),
    { key: 'none', uni: undefined, items: visible.filter((p) => !p.universityId || !unis.some((u) => u.id === p.universityId)) },
  ].filter((g) => g.items.length > 0)

  const addPackage = () => {
    const id = uid('preset')
    setPresets([...list, newPreset(id, uniFilter || unis[0]?.id)])
    setOpen(id)
  }
  const removePackage = (p: Preset) => {
    if (p.enabled || !confirm(t('common.confirmDelete'))) return
    setPresets(list.filter((x) => x.id !== p.id))
  }

  return (
    <section className="mt-12">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow>{t('admin.uni.title')}</Eyebrow>
          <p className="mt-1 max-w-2xl text-sm text-charcoal/60">{t('admin.uni.hint')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditUnis((v) => !v)}><Icon name="building" className="h-4 w-4" />{t('admin.uni.universities')} · {unis.length}</Button>
          <Button size="sm" onClick={addPackage} disabled={unis.length === 0}><Icon name="plus" className="h-4 w-4" />{t('admin.uni.addPackage')}</Button>
        </div>
      </div>
      <Notice tone="warn" className="mb-4 text-xs">{t('admin.presets.nameNotice')}</Notice>

      {(editUnis || unis.length === 0) && (
        <Card className="mb-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="font-display text-2xl text-charcoal">{t('admin.uni.universities')}</div>
            <Button size="sm" onClick={() => setUnis([...unis, newUniversity(uid('uni'))])}><Icon name="plus" className="h-4 w-4" />{t('admin.uni.addUniversity')}</Button>
          </div>
          {unis.length === 0 && <p className="text-sm text-charcoal/55">{t('admin.uni.empty')}</p>}
          <ul className="space-y-3">
            {unis.map((u) => {
              const n = usedBy(u.id)
              const patch = (v: Partial<University>) => setUnis(unis.map((x) => (x.id === u.id ? { ...x, ...v } : x)))
              const directions = universityDirections(u).length
              return (
                <li key={u.id} className="rounded-card border border-charcoal/10 bg-ivory/50 p-3">
                  <div className="grid gap-3 sm:grid-cols-[1.6fr_0.7fr_0.8fr_0.8fr_1.4fr_auto]">
                    <Field label={t('admin.uni.universityName')}><Input value={u.name} maxLength={120} onChange={(e) => patch({ name: e.target.value })} /></Field>
                    <Field label={t('admin.uni.shortName')}><Input value={u.shortName ?? ''} maxLength={30} onChange={(e) => patch({ shortName: e.target.value })} /></Field>
                    <Field label={t('admin.uni.city')}><Input value={u.city ?? ''} maxLength={60} onChange={(e) => patch({ city: e.target.value })} /></Field>
                    <Field label={t('admin.uni.country')}><Input value={u.country ?? ''} maxLength={60} onChange={(e) => patch({ country: e.target.value })} /></Field>
                    <Field label={t('admin.uni.website')}><Input type="url" placeholder="https://…" value={u.website ?? ''} onChange={(e) => patch({ website: e.target.value.trim() })} /></Field>
                    <div className="flex items-end pb-1">
                      <Button size="sm" variant="danger" aria-label={t('common.delete')} disabled={n > 0} title={n > 0 ? t('admin.uni.deleteBlocked') : undefined} onClick={() => { if (confirm(t('common.confirmDelete'))) setUnis(unis.filter((x) => x.id !== u.id)) }}><Icon name="trash" className="h-4 w-4" /></Button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <LogoField university={u} onChange={(logoUrl) => patch({ logoUrl })} onDarkChange={(logoOnDark) => patch({ logoOnDark: logoOnDark || undefined })} />
                    <div className="flex items-start lg:justify-end">
                      <Button size="sm" variant="secondary" aria-expanded={openFaculties === u.id} onClick={() => setOpenFaculties(openFaculties === u.id ? null : u.id)}>
                        <Icon name="layers" className="h-4 w-4" />{t('admin.uni.faculties')} · {(u.faculties ?? []).length} / {directions}
                      </Button>
                    </div>
                  </div>
                  {openFaculties === u.id && (
                    <div className="mt-3 border-t border-charcoal/10 pt-3">
                      <FacultiesEditor faculties={u.faculties ?? []} onChange={(faculties) => patch({ faculties })} usedDirectionIds={usedDirectionIds} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select aria-label={t('preset.university')} className="w-full sm:w-64" value={uniFilter} onChange={(e) => setUniFilter(e.target.value)}>
          <option value="">{t('uni.all')}</option>
          {unis.map((u) => <option key={u.id} value={u.id}>{u.name || '—'}</option>)}
        </Select>
        <Select aria-label={t('admin.uni.status')} className="w-full sm:w-56" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          {(['all', 'draft', 'published', 'review'] as StatusFilter[]).map((f) => <option key={f} value={f}>{t(`admin.uni.filter.${f}` as TKey)}</option>)}
        </Select>
        <span className="text-xs text-charcoal/50">{visible.length} / {list.length}</span>
      </div>

      {groups.length === 0 && <p className="rounded-card border border-dashed border-charcoal/15 p-6 text-center text-sm text-charcoal/55">{unis.length === 0 ? t('admin.uni.empty') : t('student.online.empty')}</p>}

      <div className="space-y-8">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="mb-2 font-display text-2xl text-charcoal">{g.uni ? g.uni.name || '—' : t('admin.uni.noUniversity')}{g.uni?.shortName && <span className="ml-2 text-sm text-charcoal/45">{g.uni.shortName}</span>}</div>
            <ul className="space-y-3">
              {g.items.map((p) => {
                const result = presetPublishability(p, courses)
                const missing = presetMissingSubjects(p)
                const isOpen = open === p.id
                const total = result.ready ? presetTotal(presetCourses(p, courses)) : null
                const uni = universityOf(p, unis)
                return (
                  <li key={p.id}>
                    <Card className={cx('p-0', !p.enabled && 'bg-paper/70')}>
                      <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : p.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 p-4 text-left">
                        <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
                          <div className="line-clamp-2 font-medium text-charcoal">{tr(p.name) || '—'}</div>
                          <div className="mt-0.5 truncate text-xs text-charcoal/55">{[uni?.name, tr(p.program)].filter(Boolean).join(' · ')}</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={p.enabled ? 'forest' : 'muted'}>{p.enabled ? t('admin.uni.published') : t('admin.uni.draft')}</Badge>
                          {(p.universityId || p.university) && <Badge tone={p.admission?.status === 'verified' ? 'sage' : 'warn'}>{p.admission?.status === 'verified' ? t('uni.verified') : t('uni.needsReview')}</Badge>}
                          {missing.length > 0 && <Badge tone="danger">{missing.length} ×</Badge>}
                        </div>
                        <div className="text-right text-xs text-charcoal/60">
                          <div>{p.slots.length - missing.length}/{countLabel(lang, p.slots.length, NOUNS.course)}</div>
                          {total !== null && <div className="font-medium text-charcoal">{formatSom(total, lang)}</div>}
                        </div>
                        <Icon name={isOpen ? 'x' : 'edit'} className="h-4 w-4 text-charcoal/50" />
                      </button>
                      {isOpen && (
                        <div className="space-y-5 border-t border-charcoal/10 p-4 sm:p-5">
                          <div className="grid gap-4 md:grid-cols-2">
                            <Field label={t('preset.university')}>
                              <Select value={p.universityId ?? ''} onChange={(e) => up(p.id, { universityId: e.target.value || undefined })}>
                                <option value="">{t('admin.uni.pickUniversity')}</option>
                                {unis.map((u) => <option key={u.id} value={u.id}>{u.name || '—'}</option>)}
                              </Select>
                            </Field>
                            <div />
                            <LField label={t('admin.uni.program')} value={p.program ?? emptyL()} onChange={(v) => up(p.id, { program: v })} />
                            <LField label={t('admin.uni.packageTitle')} value={p.name} onChange={(v) => up(p.id, { name: v })} />
                          </div>
                          <LField label={t('common.description')} multiline value={p.description} onChange={(v) => up(p.id, { description: v })} />

                          <div className="rounded-card border border-charcoal/10 p-4">
                            <div className="text-sm font-medium text-charcoal">{t('admin.uni.directions')}</div>
                            <p className="mb-3 text-xs text-charcoal/55">{t('admin.uni.directionsHint')}</p>
                            {(() => {
                              const options = uni && !uni.id.startsWith('legacy:') ? universityDirections(uni) : []
                              if (options.length === 0) return <p className="text-xs text-charcoal/55">{t('admin.uni.noDirections')}</p>
                              const chosen = p.directionIds ?? []
                              const toggle = (id: string) => up(p.id, { directionIds: chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id] })
                              return (
                                <div className="grid gap-2 sm:grid-cols-2">
                                  {options.map(({ faculty, direction }) => (
                                    <label key={direction.id} className={cx('flex cursor-pointer items-start gap-2 rounded-control border p-2.5 text-sm transition', chosen.includes(direction.id) ? 'border-forest/40 bg-sage/40' : 'border-charcoal/10 hover:bg-ivory')}>
                                      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-forest" checked={chosen.includes(direction.id)} onChange={() => toggle(direction.id)} />
                                      <span><span className="block font-medium text-charcoal">{tr(direction.name) || '—'}</span><span className="text-[11px] text-charcoal/50">{tr(faculty.name)}</span></span>
                                    </label>
                                  ))}
                                </div>
                              )
                            })()}
                          </div>

                          <div>
                            <div className="mb-2 text-sm font-medium text-charcoal">{t('admin.uni.subjects')}</div>
                            <ul className="space-y-3">
                              {p.slots.map((slot, i) => {
                                const picked = slot.courseId ? courses.find((c) => c.id === slot.courseId) : undefined
                                const setSlot = (v: Partial<typeof slot>) => up(p.id, { slots: p.slots.map((x) => (x.id === slot.id ? { ...x, ...v } : x)) })
                                const slotIssues = result.issues.filter((x) => x.slotId === slot.id)
                                return (
                                  <li key={slot.id} className="rounded-card border border-charcoal/10 bg-ivory/50 p-3">
                                    <div className="grid gap-2 sm:grid-cols-3">
                                      {(['uz', 'ru', 'en'] as const).map((lg) => (
                                        <div key={lg} className="relative">
                                          <span className="pointer-events-none absolute left-3 top-2.5 text-[10px] font-semibold tracking-wider text-champagne">{lg.toUpperCase()}</span>
                                          <Input aria-label={`${t('admin.uni.subjectName')} ${i + 1} ${lg.toUpperCase()}`} className="pl-9" value={slot.label[lg]} onChange={(e) => setSlot({ label: { ...slot.label, [lg]: e.target.value } })} />
                                        </div>
                                      ))}
                                    </div>
                                    <div className="mt-2 flex items-center gap-2">
                                      <Select aria-label={`${t('admin.uni.subjectName')} ${i + 1}`} value={slot.courseId ?? ''} onChange={(e) => setSlot({ courseId: e.target.value || null })}>
                                        <option value="">{t('admin.presets.pickCourse')}</option>
                                        {offline.map((c) => <option key={c.id} value={c.id}>{tr(c.title)} · {centerName(c.centerId)}{isPublicListed(c) && c.groups.length > 0 ? '' : ` — ${t('preset.unavailable')}`}</option>)}
                                      </Select>
                                      {p.slots.length > 1 && <Button size="sm" variant="ghost" aria-label={t('common.delete')} onClick={() => up(p.id, { slots: p.slots.filter((x) => x.id !== slot.id) })}><Icon name="x" className="h-3.5 w-3.5" /></Button>}
                                    </div>
                                    <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs text-charcoal/70">
                                      <input type="checkbox" className="h-4 w-4 accent-forest" checked={!!slot.optional} onChange={(e) => setSlot({ optional: e.target.checked || undefined })} />
                                      {t('admin.uni.optionalSlot')}
                                    </label>
                                    {picked ? (
                                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-charcoal/55">
                                        <FormatBadge course={picked} />
                                        <span>{tr(categories.find((x) => x.id === picked.categoryId)?.name)}</span>
                                        <span className="font-medium text-charcoal/75"><PriceNow course={picked} withCurrency /></span>
                                        {picked.groups[0] && <ScheduleChips group={picked.groups[0]} compact />}
                                      </div>
                                    ) : (
                                      <div className="mt-1.5 text-[11px] text-amber-800">{t('admin.uni.missingCourse')}</div>
                                    )}
                                    {slotIssues.filter((x) => x.reason !== 'unset').map((x) => <div key={x.reason} className="mt-1 text-[11px] text-red-700">{t(`admin.presets.issue.${x.reason}` as TKey)}</div>)}
                                  </li>
                                )
                              })}
                            </ul>
                            {p.slots.length < MAX_SUBJECTS && <Button size="sm" variant="ghost" className="mt-2" onClick={() => up(p.id, { slots: [...p.slots, { id: uid('slot'), label: emptyL(), courseId: null }] })}><Icon name="plus" className="h-4 w-4" />{t('admin.uni.addSubject')}</Button>}
                          </div>

                          <div className="grid gap-4 rounded-card border border-charcoal/10 p-4 md:grid-cols-2">
                            <Field label={t('admin.uni.duration')}>
                              <Input type="number" min={1} max={36} placeholder={String(presetDurationMonths({ ...p, durationMonths: undefined }, courses, []) ?? '')} value={p.durationMonths ?? ''}
                                onChange={(e) => { const v = Math.round(Number(e.target.value)); up(p.id, { durationMonths: e.target.value === '' || !(v >= 1 && v <= 36) ? undefined : v }) }} />
                              <span className="mt-1 block text-[11px] text-charcoal/50">{t('admin.uni.durationHint')}</span>
                            </Field>
                            <div>
                              <div className="text-sm font-medium text-charcoal">{t('admin.uni.price')}</div>
                              <div className="mt-1 font-display text-2xl text-charcoal">{presetCourses(p, courses, []).length ? formatSom(presetTotal(presetCourses(p, courses, [])), lang) : '—'}</div>
                              <p className="mt-1 text-[11px] text-charcoal/55">{t('admin.uni.priceNote')}</p>
                            </div>
                          </div>

                          <div className="rounded-card border border-charcoal/10 p-4">
                            <div className="mb-3 text-sm font-medium text-charcoal">{t('admin.uni.source')}</div>
                            <div className="grid gap-4 md:grid-cols-2">
                              <div className="md:col-span-2">
                                <Field label={t('admin.uni.sourceUrl')}>
                                  <div className="flex items-center gap-2">
                                    <Input type="url" placeholder="https://…" value={p.admission?.url ?? ''} onChange={(e) => upAdmission(p, { url: e.target.value.trim() })} />
                                    {p.admission?.url && /^https:\/\//.test(p.admission.url) && <a href={p.admission.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-forest" aria-label={t('uni.officialPage')}><Icon name="external" className="h-4 w-4" /></a>}
                                  </div>
                                </Field>
                              </div>
                              <Field label={t('admin.uni.academicYear')}><Input placeholder="2025/2026" maxLength={20} value={p.admission?.academicYear ?? ''} onChange={(e) => upAdmission(p, { academicYear: e.target.value })} /></Field>
                              <Field label={t('admin.uni.checkedOn')}><Input type="date" value={p.admission?.checkedOn ?? ''} onChange={(e) => upAdmission(p, { checkedOn: e.target.value })} /></Field>
                              <Field label={t('admin.uni.status')}>
                                <Select value={p.admission?.status ?? 'needs_review'} onChange={(e) => upAdmission(p, { status: e.target.value as AdmissionStatus })}>
                                  <option value="needs_review">{t('uni.needsReview')}</option>
                                  <option value="verified">{t('uni.verified')}</option>
                                </Select>
                              </Field>
                              <div className="md:col-span-2"><Field label={t('admin.uni.note')}><Textarea rows={2} maxLength={600} value={p.admission?.note ?? ''} onChange={(e) => upAdmission(p, { note: e.target.value })} /></Field></div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-end justify-between gap-3 border-t border-charcoal/10 pt-4">
                            <div className="min-w-0 flex-1">
                              {total !== null ? (
                                <div className="flex items-end gap-3"><span className="text-sm text-charcoal/60">{t('admin.presets.total')}</span><span className="font-display text-2xl text-charcoal">{formatSom(total, lang)}</span></div>
                              ) : (
                                <p className="text-xs text-charcoal/55">{t('admin.uni.publishBlocked')}</p>
                              )}
                              {!result.ok && result.admission.length > 0 && (p.universityId || p.university) && <ul className="mt-1 text-[11px] text-red-700">{result.admission.map((a) => <li key={a}>{t(`admin.uni.issue.${a}` as TKey)}</li>)}</ul>}
                              <p className="mt-1 text-[11px] text-amber-800">{t('preset.provisional')}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {p.enabled ? (
                                <Button size="sm" variant="secondary" onClick={() => up(p.id, { enabled: false })}>{t('admin.uni.unpublish')}</Button>
                              ) : (
                                <Button size="sm" disabled={!result.ok} title={!result.ok ? t('admin.uni.publishBlocked') : undefined} onClick={() => up(p.id, { enabled: true })}>{t('admin.uni.publish')}</Button>
                              )}
                              <Button size="sm" variant="danger" disabled={p.enabled} title={p.enabled ? t('admin.uni.deletePublished') : undefined} onClick={() => removePackage(p)}><Icon name="trash" className="h-3.5 w-3.5" />{t('admin.uni.deleteDraft')}</Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </Card>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
