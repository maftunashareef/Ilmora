import { useState } from 'react'
import { useNavigate } from '@/lib/router'
import { Avatar, Badge, Button, Card, Eyebrow, Field, Icon, Input, LField, Modal, Notice, PageTitle, Select, Toggle } from '../../components/ui'
import { getTeacherAvatarUrl } from '../../components/teacher/teacherImage'
import { emptyL, useT } from '../../i18n/useT'
import { uid, useStore } from '../../store/useStore'
import { enrolledCount, isGroupFull } from '../../lib/enrollment'
import type { Student, Teacher } from '../../types'

export function AdminPeople() {
  const { t, tr } = useT()
  const nav = useNavigate()
  const s = useStore()
  const [teacher, setTeacher] = useState<Teacher | null>(null)
  const [student, setStudent] = useState<Student | null>(null)
  const groups = s.courses.flatMap((c) => c.groups.map((g) => ({ ...g, course: tr(c.title) })))

  const newTeacher = (): Teacher => ({ id: uid('t'), name: '', title: emptyL(), bio: emptyL(), expertise: [], centerId: s.centers[0]?.id ?? '', avatarSeed: Math.floor(Math.random() * 60), bannerTone: '#163C35', tagline: emptyL(), channelActive: false })
  const newStudent = (): Student => ({ id: uid('s'), profile: { displayName: '', district: '', preferredLang: 'uz', reminders: true }, subscription: { packageId: null, groupIds: [], status: 'none' }, savedCourseIds: [], savedTeacherIds: [], builder: { packageId: null, groupIds: [], meyosGrant: false } })
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
                  <div className="truncate text-xs text-charcoal/55">{tr(te.title)} · {s.centers.find((c) => c.id === te.centerId)?.name} · {s.courses.filter((c) => c.teacherId === te.id).length} {t('common.courses').toLowerCase()}</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => actAs('teacher', te.id)} title={t('admin.people.actAs')}><Icon name="eye" className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="secondary" onClick={() => setTeacher(te)}><Icon name="edit" className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="danger" disabled={s.courses.some((c) => c.teacherId === te.id)} title={s.courses.some((c) => c.teacherId === te.id) ? t('admin.centers.inUse') : undefined} onClick={() => { if (confirm(t('common.confirmDelete'))) s.removeTeacher(te.id) }}><Icon name="trash" className="h-3.5 w-3.5" /></Button>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <div className="mb-3 flex items-center justify-between"><Eyebrow>{t('admin.people.students')} · {s.students.length}</Eyebrow><Button size="sm" onClick={() => setStudent(newStudent())}><Icon name="plus" className="h-3.5 w-3.5" />{t('admin.people.addStudent')}</Button></div>
          <ul className="space-y-2">
            {s.students.map((st) => {
              const pkg = s.site.packages.find((p) => p.id === st.subscription.packageId)
              return (
                <li key={st.id} className="card flex items-center gap-3 p-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sage text-forest"><Icon name="user" className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-medium text-charcoal">{st.profile.displayName}</span>{st.subscription.status === 'active' && pkg ? <Badge tone="forest">{tr(pkg.name)}</Badge> : <Badge tone="muted">{t('admin.people.noSub')}</Badge>}</div>
                    <div className="truncate text-xs text-charcoal/55">{st.profile.district} · {st.subscription.groupIds.map((gid) => groups.find((g) => g.id === gid)?.course).filter(Boolean).join(', ') || '—'}</div>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setStudent(st)}><Icon name="edit" className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="danger" onClick={() => { if (confirm(t('common.confirmDelete'))) s.removeStudent(st.id) }}><Icon name="trash" className="h-3.5 w-3.5" /></Button>
                </li>
              )
            })}
          </ul>
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
      <Modal open={!!student} onClose={() => setStudent(null)} title={student?.profile.displayName || t('admin.people.addStudent')} footer={<><Button variant="ghost" onClick={() => setStudent(null)}>{t('common.cancel')}</Button><Button onClick={() => { if (student?.profile.displayName.trim()) { s.upsertStudent(student); setStudent(null); s.notify(t('common.saved')) } }}>{t('common.save')}</Button></>}>
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
                      const full = !inGroup && isGroupFull(g, s.students, student.id)
                      return (
                      <label key={g.id} className={`flex items-center gap-2 rounded-control border border-charcoal/10 bg-paper px-2.5 py-1.5 text-xs ${full ? 'opacity-50' : ''}`} title={full ? t('capacity.full') : undefined}><input type="checkbox" className="accent-forest" disabled={full} checked={inGroup} onChange={() => setStudent({ ...student, subscription: { ...student.subscription, groupIds: inGroup ? student.subscription.groupIds.filter((x) => x !== g.id) : [...student.subscription.groupIds, g.id] } })} /><span className="truncate">{g.course} · {g.name}</span><span className="ml-auto shrink-0 text-charcoal/45">{enrolledCount(s.students, g.id, student.id)}/{g.capacity}</span></label>
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
