import { useCallback, useEffect, useState } from 'react'
import { Avatar, Badge, Button, Card, Eyebrow, Field, Icon, Input, LField, Modal, Notice, PageTitle, Select, Toggle } from '../../components/ui'
import { getTeacherAvatarUrl } from '../../components/teacher/teacherImage'
import { countLabel, NOUNS } from '@ilmora/shared'
import { api } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { emptyL, useT } from '../../i18n/useT'
import { formatDate } from '../../lib/format'
import { siteHref } from '../../lib/siteUrl'
import { uid, useStore } from '../../store/useStore'
import type { Lang, Student, Teacher } from '../../types'

/** One row of the paginated admin user list (students only here). */
type StudentRow = { id: string; displayName: string; district: string | null; preferredLang: Lang; roles: string[]; isActive: boolean; subscription: { packageId: string | null; status: string; startedAt: string | null; currentPeriodEnd: string | null } | null; groupIds: string[] }
const toStudent = (u: StudentRow): Student => ({
  id: u.id,
  profile: { displayName: u.displayName, district: u.district ?? '', preferredLang: u.preferredLang, reminders: true },
  subscription: { packageId: u.subscription?.packageId ?? null, groupIds: u.groupIds ?? [], status: u.subscription?.status === 'ACTIVE' ? 'active' : 'none', startedAt: u.subscription?.startedAt ?? undefined, renewsAt: u.subscription?.currentPeriodEnd ?? undefined },
  savedCourseIds: [], savedTeacherIds: [], builder: { packageId: null, groupIds: [], meyosGrant: false },
})

export function AdminPeople() {
  const { t, tr, lang } = useT()
  const s = useStore()
  const me = s.auth.user?.id
  const [teacher, setTeacher] = useState<Teacher | null>(null)
  const [student, setStudent] = useState<Student | null>(null)
  const [saving, setSaving] = useState(false)
  const groups = s.courses.flatMap((c) => c.groups.map((g) => ({ ...g, course: tr(c.title) })))
  const groupLabels = (ids: string[]) => ids.flatMap((gid) => { const g = groups.find((x) => x.id === gid); return g ? [`${g.course} · ${g.name}`] : [] }).join(', ') || '—'
  const studentPkg = student ? s.site.packages.find((p) => p.id === student.subscription.packageId) : undefined

  // Students are loaded paginated from the server (not the shared store), so the screen scales past a few hundred accounts.
  const [rows, setRows] = useState<StudentRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const notify = s.notify
  const loadStudents = useCallback(async (p = 1) => {
    const qs = new URLSearchParams({ role: 'STUDENT', page: String(p), pageSize: '50', ...(query.trim() ? { search: query.trim() } : {}) })
    try {
      const r = await api<{ items: StudentRow[]; total: number; page: number }>(`/admin/users?${qs.toString()}`)
      setRows(r.items); setTotal(r.total); setPage(r.page)
    } catch (err) { notify(apiErrorText(err, lang), 'warn') }
  }, [query, lang, notify])
  useEffect(() => { void loadStudents(1) }, [loadStudents])

  const newTeacher = (): Teacher => ({ id: uid('t'), name: '', title: emptyL(), bio: emptyL(), expertise: [], centerId: s.centers[0]?.id ?? '', avatarSeed: Math.floor(Math.random() * 60), bannerTone: '#0E5A44', tagline: emptyL(), channelActive: false })
  // Impersonation is not available in production; admins open the public channel instead.
  const actAs = (role: 'teacher' | 'student', id: string) => { if (role === 'teacher') window.location.assign(siteHref(lang, `/teachers/${id}`)) }
  // Dialogs close and report "Saved" only once the API has answered; the store toasts the error otherwise.
  const saveTeacher = async () => {
    if (!teacher?.name.trim() || saving) return
    setSaving(true)
    try { await s.upsertTeacher(teacher); setTeacher(null); s.notify(t('common.saved')) } catch { /* toasted by the store */ } finally { setSaving(false) }
  }
  const saveStudent = async () => {
    if (!student?.profile.displayName.trim() || saving) return
    setSaving(true)
    try { await s.upsertStudent(student); setStudent(null); s.notify(t('common.saved')); void loadStudents(page) } catch { /* toasted by the store */ } finally { setSaving(false) }
  }
  // Blocking keeps the account's roles (a teacher or center administrator may also be a student); it is undone on the Accounts screen.
  const blockStudent = async (row: StudentRow) => {
    if (!confirm(t('admin.people.blockConfirm'))) return
    try { await s.deactivateStudent(row.id, row.roles); void loadStudents(page) } catch { /* toasted by the store */ }
  }

  return (
    <div>
      <PageTitle eyebrow={t('dash.admin')} title={t('admin.people')} subtitle={t('admin.people.privacy')} />
      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center justify-between"><Eyebrow>{t('admin.people.teachers')} · {s.teachers.length}</Eyebrow><Button size="sm" onClick={() => setTeacher(newTeacher())}><Icon name="plus" className="h-3.5 w-3.5" />{t('admin.people.addTeacher')}</Button></div>
          <ul className="space-y-2">
            {s.teachers.map((te) => (
              <li key={te.id} className="card flex items-center gap-3 p-3">
                <Avatar name={te.name || '?'} seed={te.avatarSeed} size={40} url={getTeacherAvatarUrl(te)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-medium text-charcoal">{te.name}</span>{te.channelActive ? <Badge tone="sage">{t('admin.people.channelActive')}</Badge> : <Badge tone="muted">{t('teachers.channelInactive')}</Badge>}</div>
                  <div className="truncate text-xs text-charcoal/55">{tr(te.title)} · {s.centers.find((c) => c.id === te.centerId)?.name} · {countLabel(lang, s.courses.filter((c) => c.teacherId === te.id).length, NOUNS.course)}</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => actAs('teacher', te.id)} title={t('admin.people.actAs')}><Icon name="eye" className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="secondary" onClick={() => setTeacher(te)} aria-label={t('common.edit')}><Icon name="edit" className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="danger" disabled={s.courses.some((c) => c.teacherId === te.id)} title={s.courses.some((c) => c.teacherId === te.id) ? t('admin.centers.inUse') : undefined} onClick={() => { if (confirm(t('common.confirmDelete'))) s.removeTeacher(te.id).catch(() => undefined) }} aria-label={t('common.delete')}><Icon name="trash" className="h-3.5 w-3.5" /></Button>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <div className="mb-3 flex items-center justify-between"><Eyebrow>{t('admin.people.students')} · {total}</Eyebrow></div>
          <form className="mb-3" onSubmit={(e) => { e.preventDefault(); void loadStudents(1) }}>
            <Input aria-label={t('admin.accounts.search')} placeholder={t('admin.accounts.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </form>
          <ul className="space-y-2">
            {rows.map((row) => {
              const st = toStudent(row)
              const pkg = s.site.packages.find((p) => p.id === st.subscription.packageId)
              return (
                <li key={st.id} className="card flex items-center gap-3 p-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sage text-forest"><Icon name="user" className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-medium text-charcoal">{st.profile.displayName}</span>{st.subscription.status === 'active' && pkg ? <Badge tone="forest">{tr(pkg.name)}</Badge> : <Badge tone="muted">{t('admin.people.noSub')}</Badge>}{!row.isActive && <Badge tone="danger">{t('admin.accounts.blocked')}</Badge>}</div>
                    <div className="truncate text-xs text-charcoal/55">{st.profile.district} · {st.subscription.groupIds.map((gid) => groups.find((g) => g.id === gid)?.course).filter(Boolean).join(', ') || '—'}</div>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setStudent(st)} aria-label={t('common.edit')}><Icon name="edit" className="h-3.5 w-3.5" /></Button>
                  {/* Super Admin accounts and the signed-in admin are never blocked from here (the roles endpoint would also drop the owner flag). */}
                  {row.isActive && row.id !== me && !row.roles.includes('PLATFORM_ADMIN') && (
                    <Button size="sm" variant="danger" onClick={() => void blockStudent(row)} aria-label={t('admin.accounts.block')} title={t('admin.accounts.block')}><Icon name="lock" className="h-3.5 w-3.5" /></Button>
                  )}
                </li>
              )
            })}
          </ul>
          {rows.length === 0 && <p className="py-6 text-center text-sm text-charcoal/50">{t('admin.accounts.noResults')}</p>}
          {total > 50 && (
            <div className="mt-4 flex items-center justify-between text-xs text-charcoal/55">
              <span>{total}</span>
              <div className="flex gap-2"><Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => void loadStudents(page - 1)}>{t('common.back')}</Button><Button size="sm" variant="ghost" disabled={page * 50 >= total} onClick={() => void loadStudents(page + 1)}>{t('common.next')}</Button></div>
            </div>
          )}
          <Notice tone="info" className="mt-4 text-xs">{t('admin.people.privacy')}</Notice>
        </section>
      </div>

      <Modal open={!!teacher} onClose={() => setTeacher(null)} title={teacher?.name || t('admin.people.addTeacher')} footer={<><Button variant="ghost" onClick={() => setTeacher(null)}>{t('common.cancel')}</Button><Button disabled={saving} onClick={() => void saveTeacher()}>{t('common.save')}</Button></>}>
        {teacher && (
          <div className="space-y-4">
            <Field label={t('common.personName')} required><Input value={teacher.name} onChange={(e) => setTeacher({ ...teacher, name: e.target.value })} /></Field>
            <LField label={t('studio.channel.titleField')} value={teacher.title} onChange={(v) => setTeacher({ ...teacher, title: v })} />
            <LField label={t('studio.channel.bio')} multiline value={teacher.bio} onChange={(v) => setTeacher({ ...teacher, bio: v })} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('common.center')}><Select value={teacher.centerId ?? ''} onChange={(e) => setTeacher({ ...teacher, centerId: e.target.value })}>{s.centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
              <Field label={t('studio.channel.expertise')}><Input value={teacher.expertise.join(', ')} onChange={(e) => setTeacher({ ...teacher, expertise: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></Field>
            </div>
            <Toggle checked={teacher.channelActive} onChange={(v) => setTeacher({ ...teacher, channelActive: v })} label={t('admin.people.channelActive')} />
          </div>
        )}
      </Modal>
      <Modal open={!!student} onClose={() => setStudent(null)} title={student?.profile.displayName || t('admin.people.students')} footer={<><Button variant="ghost" onClick={() => setStudent(null)}>{t('common.cancel')}</Button><Button disabled={saving} onClick={() => void saveStudent()}>{t('common.save')}</Button></>}>
        {student && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('student.profile.displayName')} required><Input value={student.profile.displayName} onChange={(e) => setStudent({ ...student, profile: { ...student.profile, displayName: e.target.value } })} /></Field>
              <Field label={t('student.profile.district')}><Input value={student.profile.district} onChange={(e) => setStudent({ ...student, profile: { ...student.profile, district: e.target.value } })} /></Field>
            </div>
            {/* Read-only: PATCH /admin/users/:id accepts profile fields only; enrollments and periods change through payments. */}
            <Card className="bg-ivory/50 p-4">
              <Eyebrow className="mb-2">{t('admin.people.subscription')}</Eyebrow>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-charcoal/50">{t('student.sub.package')}</dt><dd className="mt-0.5 font-medium text-charcoal">{student.subscription.status === 'active' ? (studentPkg ? tr(studentPkg.name) : t('builder.custom')) : t('admin.people.noSub')}</dd></div>
                <div><dt className="text-xs text-charcoal/50">{t('student.sub.renews')}</dt><dd className="mt-0.5 font-medium text-charcoal">{student.subscription.renewsAt ? formatDate(student.subscription.renewsAt, lang) : '—'}</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs text-charcoal/50">{t('common.groups')}</dt><dd className="mt-0.5 font-medium text-charcoal">{groupLabels(student.subscription.groupIds)}</dd></div>
              </dl>
              <Notice tone="info" className="mt-3 text-xs">{t('admin.people.subReadOnly')}</Notice>
            </Card>
          </div>
        )}
      </Modal>
    </div>
  )
}
