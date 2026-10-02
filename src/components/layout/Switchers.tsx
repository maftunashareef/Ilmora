import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LANGS } from '../../i18n/translations'
import { useT } from '../../i18n/useT'
import { useStore } from '../../store/useStore'
import type { Role } from '../../types'
import { Avatar, Button, cx, Icon, Select } from '../ui'

export function LangSwitcher({ compact }: { compact?: boolean }) {
  const lang = useStore((s) => s.lang)
  const setLang = useStore((s) => s.setLang)
  const { t } = useT()
  return (
    <div role="group" aria-label={t('common.language')} className="inline-flex rounded-full border border-charcoal/12 bg-paper p-0.5">
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          aria-pressed={lang === l.code}
          onClick={() => setLang(l.code)}
          className={cx('rounded-full font-medium transition', compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1 text-xs', lang === l.code ? 'bg-forest text-ivory' : 'text-charcoal/60 hover:text-charcoal')}
        >
          {l.short}
        </button>
      ))}
    </div>
  )
}

const ROLES: Role[] = ['visitor', 'student', 'teacher', 'admin']
const WORKSPACE: Record<Role, string | null> = { visitor: null, student: '/student', teacher: '/teacher', admin: '/admin' }

export function RoleSwitcher({ align = 'right' }: { align?: 'left' | 'right' }) {
  const { t } = useT()
  const role = useStore((s) => s.role)
  const setRole = useStore((s) => s.setRole)
  const teachers = useStore((s) => s.teachers)
  const students = useStore((s) => s.students)
  const currentTeacherId = useStore((s) => s.currentTeacherId)
  const currentStudentId = useStore((s) => s.currentStudentId)
  const setCurrentTeacher = useStore((s) => s.setCurrentTeacher)
  const setCurrentStudent = useStore((s) => s.setCurrentStudent)
  const resetDemo = useStore((s) => s.resetDemo)
  const notify = useStore((s) => s.notify)
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const teacher = teachers.find((x) => x.id === currentTeacherId)
  const student = students.find((x) => x.id === currentStudentId)
  const who = role === 'teacher' ? teacher?.name : role === 'student' ? student?.profile.displayName : role === 'admin' ? 'Super Admin' : t('role.visitor')

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-2 rounded-full border border-champagne/70 bg-champagne/15 py-1 pl-1 pr-3 text-xs font-medium text-charcoal transition hover:bg-champagne/30"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-forest text-ivory"><Icon name="user" className="h-3 w-3" /></span>
        <span className="hidden sm:inline text-[10px] uppercase tracking-[0.18em] text-charcoal/55">{t('common.demoRole')}</span>
        <span className="max-w-[10rem] truncate">{t(`role.${role}`)}</span>
        <Icon name="down" className="h-3 w-3 text-charcoal/50" />
      </button>
      {open && (
        <div role="dialog" aria-label={t('common.demoRole')} className={cx('animate-rise absolute z-[70] mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-card border border-charcoal/10 bg-paper p-4 shadow-lift', align === 'right' ? 'right-0' : 'left-0')}>
          <div className="eyebrow mb-1">{t('common.demoRole')}</div>
          <p className="mb-3 text-xs text-charcoal/55">{t('role.switchHint')}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {ROLES.map((r) => (
              <button key={r} type="button" aria-pressed={role === r} onClick={() => setRole(r)} className={cx('rounded-control border px-3 py-2 text-left text-sm transition', role === r ? 'border-forest bg-forest text-ivory' : 'border-charcoal/10 hover:border-forest/40')}>
                {t(`role.${r}`)}
              </button>
            ))}
          </div>
          {role === 'teacher' && (
            <div className="mt-3 flex items-center gap-2">
              {teacher && <Avatar name={teacher.name} seed={teacher.avatarSeed} size={32} url={teacher.avatarUpload?.previewUrl} />}
              <Select value={currentTeacherId} onChange={(e) => setCurrentTeacher(e.target.value)} aria-label={t('common.teacher')}>
                {teachers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </div>
          )}
          {role === 'student' && (
            <div className="mt-3">
              <Select value={currentStudentId} onChange={(e) => setCurrentStudent(e.target.value)} aria-label={t('common.student')}>
                {students.map((x) => <option key={x.id} value={x.id}>{x.profile.displayName}</option>)}
              </Select>
            </div>
          )}
          <div className="mt-3 text-xs text-charcoal/55">{t('role.viewingAs')} <span className="font-medium text-charcoal">{who}</span></div>
          <div className="mt-4 flex items-center justify-between gap-2 border-t border-charcoal/10 pt-3">
            <Button size="sm" variant="ghost" className="text-charcoal/60" onClick={() => { if (confirm(t('common.resetConfirm'))) { resetDemo(); notify(t('common.saved')); setOpen(false); nav('/') } }}>
              <Icon name="refresh" className="h-3.5 w-3.5" /> {t('common.resetDemo')}
            </Button>
            {WORKSPACE[role] && (
              <Button size="sm" onClick={() => { setOpen(false); nav(WORKSPACE[role]!) }}>
                {t('role.openWorkspace')} <Icon name="arrowRight" className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
