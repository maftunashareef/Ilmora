import { useState } from 'react'
import { Link } from '@/lib/router'
import { GroupsEditor, groupsCapacityError } from '../../components/course/CourseForm'
import { ScheduleChips } from '../../components/course/CourseCard'
import { Timetable } from '../../components/Timetable'
import { Badge, Button, Card, Eyebrow, Icon, Modal, Notice, PageTitle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { enrolledCount } from '../../lib/enrollment'
import { findConflicts } from '../../lib/schedule'
import { useCurrentTeacher } from '../../store/selectors'
import { useStore } from '../../store/useStore'
import type { Course, Group } from '../../types'

export function StudioGroups() {
  const { t, tr } = useT()
  const teacher = useCurrentTeacher()
  const courses = useStore((s) => s.courses.filter((c) => c.teacherId === teacher?.id))
  const students = useStore((s) => s.students)
  const perms = useStore((s) => s.site.permissions.teacher)
  const { upsertCourse, notify } = useStore()
  const [editing, setEditing] = useState<Course | null>(null)
  const [draftGroups, setDraftGroups] = useState<Group[]>([])
  const locked = !(perms.manageGroups && perms.editSchedules)
  const groups = courses.flatMap((c) => c.groups)
  const conflicts = findConflicts(groups)
  const roster = (gid: string) => students.filter((st) => st.subscription.status === 'active' && st.subscription.groupIds.includes(gid))
  return (
    <div>
      <PageTitle eyebrow={t('dash.teacherStudio')} title={t('studio.groups')} subtitle={t('studio.groups.hint')} />
      {locked && <Notice tone="warn" className="mb-6"><Icon name="lock" className="mr-1 inline h-3.5 w-3.5" />{t('studio.lockedByAdmin')}: {t('perm.teacher.manageGroups')} / {t('perm.teacher.editSchedules')}</Notice>}
      <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
        <section className="space-y-4">
          {courses.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="mb-3 flex items-center justify-between gap-3"><div className="font-display text-xl text-charcoal">{tr(c.title)}</div><Button size="sm" variant="secondary" disabled={locked} onClick={() => { setEditing(c); setDraftGroups(c.groups) }}><Icon name="edit" className="h-3.5 w-3.5" />{t('common.edit')}</Button></div>
              <ul className="space-y-2">
                {c.groups.map((g) => {
                  const r = roster(g.id)
                  const seats = enrolledCount(students, g.id)
                  const clash = conflicts.some((k) => k.a.id === g.id || k.b.id === g.id)
                  return (
                    <li key={g.id} className="rounded-control border border-charcoal/10 bg-ivory/50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium text-charcoal">{g.name}</span><span className="flex gap-1">{clash && <Badge tone="danger">{t('builder.conflict')}</Badge>}<Badge tone={seats >= g.capacity ? 'warn' : 'muted'}>{t('capacity.students', { n: seats, max: g.capacity })} · {t('common.room')} {g.room}</Badge></span></div>
                      <div className="mt-1.5"><ScheduleChips group={g} /></div>
                      {r.length > 0 && <div className="mt-2 text-[11px] text-charcoal/55"><span className="font-medium text-charcoal/70">{t('studio.groups.roster')}:</span> {r.map((s) => s.profile.displayName).join(', ')}</div>}
                      <Link to={`/teacher/groups/${g.id}`} className="arrow-nudge mt-2 inline-flex items-center gap-1 text-xs font-medium text-forest">{t('group.open')} <Icon name="arrowRight" className="h-3.5 w-3.5" /></Link>
                    </li>
                  )
                })}
                {c.groups.length === 0 && <li className="text-xs text-charcoal/45">{t('common.empty')}</li>}
              </ul>
            </Card>
          ))}
        </section>
        <section>
          <Eyebrow className="mb-3">{t('studio.mySchedule')}</Eyebrow>
          <Timetable groups={groups} courses={courses} conflicts={conflicts} />
        </section>
      </div>
      <Modal wide open={!!editing} onClose={() => setEditing(null)} title={editing ? tr(editing.title) : ''} footer={<><Button variant="ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</Button><Button onClick={() => { if (!editing) return; const bad = groupsCapacityError(draftGroups, students); if (bad) { notify(bad.check.reason === 'not-integer' ? t('capacity.invalid') : t('capacity.belowEnrolled', { n: bad.check.enrolled }), 'warn'); return } upsertCourse({ ...editing, groups: draftGroups, updatedAt: new Date().toISOString() }); setEditing(null); notify(t('common.saved')) }}>{t('common.save')}</Button></>}>
        {editing && <GroupsEditor groups={draftGroups} onChange={setDraftGroups} courseId={editing.id} locked={locked} />}
      </Modal>
    </div>
  )
}
