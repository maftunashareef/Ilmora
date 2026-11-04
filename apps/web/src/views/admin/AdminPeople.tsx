import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from '@/lib/router'
import { Avatar, Badge, Button, Card, Eyebrow, Field, Icon, Input, LField, Modal, Notice, PageTitle, Select, Toggle } from '../../components/ui'
import { getTeacherAvatarUrl } from '../../components/teacher/teacherImage'
import { countLabel, NOUNS } from '@ilmora/shared'
import { api } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { emptyL, useT } from '../../i18n/useT'
import { uid, useStore } from '../../store/useStore'
import { enrolledCount, isGroupFull } from '../../lib/enrollment'
import type { Lang, Student, Teacher } from '../../types'

/** One row of the paginated admin user list (students only here). */
type StudentRow = { id: string; displayName: string; district: string | null; preferredLang: Lang; subscription: { packageId: string | null; status: string; startedAt: string | null; currentPeriodEnd: string | null } | null; groupIds: string[] }
const toStudent = (u: StudentRow): Student => ({
  id: u.id,
  profile: { displayName: u.displayName, district: u.district ?? '', preferredLang: u.preferredLang, reminders: true },
  subscription: { packageId: u.subscription?.packageId ?? null, groupIds: u.groupIds ?? [], status: u.subscription?.status === 'ACTIVE' ? 'active' : 'none', startedAt: u.subscription?.startedAt ?? undefined, renewsAt: u.subscription?.currentPeriodEnd ?? undefined },
  savedCourseIds: [], savedTeacherIds: [], builder: { packageId: null, groupIds: [], meyosGrant: false },
})

export function AdminPeople() {
  const { t, tr, lang } = useT()
  const nav = useNavigate()
  const s = useStore()
  const [teacher, setTeacher] = useState<Teacher | null>(null)
  const [student, setStudent] = useState<Student | null>(null)
  const groups = s.courses.flatMap((c) => c.groups.map((g) => ({ ...g, course: tr(c.title) })))

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

  const newTeacher = (): Teacher => ({ id: uid('t'), name: '', title: emptyL(), bio: emptyL(), expertise: [], centerId: s.centers[0]?.id ?? '', avatarSeed: Math.floor(Math.random() * 60), bannerTone: '#163C35', tagline: emptyL(), channelActive: false })
  // Impersonation is not available in production; admins open the public channel instead.
  const actAs = (role: 'teacher' | 'student', id: string) => { if (role === 'teacher') nav(`/teachers/${id}`) }

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
                <Button size="sm" variant="secondary" onClick={() => setTeacher(te)}><Icon name="edit" className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="danger" disabled={s.courses.some((c) => c.teacherId === te.id)} title={s.courses.some((c) => c.teacherId === te.id) ? t('admin.centers.inUse') : undefined} onClick={() => { if (confirm(t('common.confirmDelete'))) s.removeTeacher(te.id) }}><Icon name="trash" className="h-3.5 w-3.5" /></Button>
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
                    <div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-medium text-charcoal">{st.profile.displayName}</span>{st.subscription.status === 'active' && pkg ? <Badge tone="forest">{tr(pkg.name)}</Badge> : <Badge tone="muted">{t('admin.people.noSub')}</Badge>}</div>
                    <div className="truncate text-xs text-charcoal/55">{st.profile.district} · {st.subscription.groupIds.map((gid) => groups.find((g) => g.id === gid)?.course).filter(Boolean).join(', ') || '—'}</div>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setStudent(st)}><Icon name="edit" className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="danger" onClick={async () => { if (confirm(t('common.confirmDelete'))) { await s.removeStudent(st.id); void loadStudents(page) } }}><Icon name="trash" className="h-3.5 w-3.5" /></Button>
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

      <Modal open={!!teacher} onClose={() => setTeacher(null)} title={teacher?.name || t('admin.people.addTeacher')} footer={<><Button variant="ghost" onClick={() => setTeacher(null)}>{t('common.cancel')}</Button><Button onClick={() => { if (teacher?.name.trim()) { s.upsertTeacher(teacher); setTeacher(null); s.notify(t('common.saved')) } }}>{t('common.save')}</Button></>}>
        {teacher && (
          <div className="space-y-4">
            <Field label={t('common.name')} required><Input value={teacher.name} onChange={(e) => setTeacher({ ...teacher, name: e.target.value })} /></Field>
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
      <Modal open={!!student} onClose={() => setStudent(null)} title={student?.profile.displayName || t('admin.people.students')} footer={<><Button variant="ghost" onClick={() => setStudent(null)}>{t('common.cancel')}</Button><Button onClick={async () => { if (student?.profile.displayName.trim()) { await s.upsertStudent(student); setStudent(null); s.notify(t('common.saved')); void loadStudents(page) } }}>{t('common.save')}</Button></>}>
        {student && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('student.profile.displayName')} required><Input value={student.profile.displayName} onChange={(e) => setStudent({ ...student, profile: { ...student.profile, displayName: e.target.value } })} /></Field>
              <Field label={t('student.profile.district')}><Input value={student.profile.district} onChange={(e) => setStudent({ ...student, profile: { ...student.profile, district: e.target.value } })} /></Field>
            </div>
            <Card className="bg-ivory/50 p-4">
              <Eyebrow className="mb-2">{t('admin.people.subscription')}</Eyebrow>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('student.sub.package')}><Select value={student.subscription.packageId ?? ''} onChange={(e) => { const packageId = e.target.value || null; setStudent({ ...student, subscription: { ...student.subscription, packageId, status: packageId ? 'active' : 'none', groupIds: packageId ? student.subscription.groupIds : [] } }) }}><option value="">{t('admin.people.noSub')}</option>{s.site.packages.map((p) => <option key={p.id} value={p.id}>{tr(p.name)} ({p.maxCourses})</option>)}</Select></Field>
                <Field label={t('student.sub.renews')}><Input type="date" value={student.subscription.renewsAt ?? ''} onChange={(e) => setStudent({ ...student, subscription: { ...student.subscription, renewsAt: e.target.value } })} /></Field>
              </div>
              {student.subscription.packageId && (
                <div className="mt-3">
                  <div className="mb-1.5 text-xs font-medium text-charcoal/70">{t('common.groups')}</div>
                  <div className="grid max-h-48 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
                    {groups.map((g) => {
                      const inGroup = student.subscription.groupIds.includes(g.id)
                      const full = !inGroup && isGroupFull(g, [student], student.id)
                      return (
                      <label key={g.id} className={`flex items-center gap-2 rounded-control border border-charcoal/10 bg-paper px-2.5 py-1.5 text-xs ${full ? 'opacity-50' : ''}`} title={full ? t('capacity.full') : undefined}><input type="checkbox" className="accent-forest" disabled={full} checked={inGroup} onChange={() => setStudent({ ...student, subscription: { ...student.subscription, groupIds: inGroup ? student.subscription.groupIds.filter((x) => x !== g.id) : [...student.subscription.groupIds, g.id] } })} /><span className="truncate">{g.course} · {g.name}</span><span className="ml-auto shrink-0 text-charcoal/45">{enrolledCount([student], g.id, student.id)}/{g.capacity}</span></label>
                      )
                    })}
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}
      </Modal>
    </div>
  )
}
