import { useRef, useState } from 'react'
import { newDirection, newFaculty } from '@ilmora/shared'
import { Button, Field, Icon, Input, LField } from '../../components/ui'
import { emptyL, useT } from '../../i18n/useT'
import { api, isApiError } from '../../lib/api'
import { uid } from '../../store/useStore'
import type { University, UniversityFaculty } from '../../types'
import { UniversityLogo } from '../public/Universities'

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const LOGO_MAX_BYTES = 2 * 1024 * 1024
const MAX_ENTRANCE_SUBJECTS = 8

/**
 * The university's official logo: uploaded to object storage when the environment has it (a presigned PUT; the address
 * is saved with the site settings), or entered as an https link. Nothing is stored until the upload succeeded.
 */
export function LogoField({ university, onChange, onDarkChange }: { university: University; onChange: (logoUrl: string) => void; onDarkChange: (onDark: boolean) => void }) {
  const { t } = useT()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const upload = async (file: File | undefined) => {
    if (!file) return
    setError('')
    if (!LOGO_TYPES.includes(file.type) || file.size > LOGO_MAX_BYTES) { setError(t('admin.uni.logoHint')); return }
    setBusy(true)
    try {
      const { uploadUrl, publicUrl } = await api<{ uploadUrl: string; publicUrl: string }>('/admin/site/university-logo/upload-url', { method: 'POST', body: { fileName: file.name, contentType: file.type, fileSize: file.size } })
      const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
      if (!put.ok) throw new Error(`upload ${put.status}`)
      onChange(publicUrl)
    } catch (err) {
      setError(isApiError(err) && err.code === 'storage_not_configured' ? t('admin.uni.logoStorageOff') : t('admin.uni.logoUploadFailed'))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <Field label={t('admin.uni.logo')}>
      <div className="flex items-start gap-3">
        <UniversityLogo key={university.logoUrl} university={university} size={56} />
        <div className="min-w-0 flex-1 space-y-2">
          <Input type="url" aria-label={t('admin.uni.logoUrl')} placeholder={t('admin.uni.logoUrl')} value={university.logoUrl ?? ''} onChange={(e) => onChange(e.target.value.trim())} />
          <div className="flex flex-wrap items-center gap-2">
            <input ref={input} type="file" accept={LOGO_TYPES.join(',')} className="sr-only" aria-label={t('admin.uni.logoUpload')} onChange={(e) => void upload(e.target.files?.[0])} />
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => input.current?.click()}><Icon name={busy ? 'refresh' : 'upload'} className={busy ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />{t('admin.uni.logoUpload')}</Button>
            {university.logoUrl && <Button size="sm" variant="ghost" onClick={() => onChange('')} aria-label={t('common.delete')}><Icon name="x" className="h-3.5 w-3.5" /></Button>}
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-charcoal/70">
            <input type="checkbox" className="h-4 w-4 accent-forest" checked={!!university.logoOnDark} onChange={(e) => onDarkChange(e.target.checked)} />
            {t('admin.uni.logoOnDark')}
          </label>
          <p className="text-[11px] text-charcoal/50">{t('admin.uni.logoHint')}</p>
          {error && <p className="text-[11px] text-red-700" role="alert">{error}</p>}
        </div>
      </div>
    </Field>
  )
}

/**
 * Faculties → directions → entrance subjects, as the university's official page names them. A direction that a package
 * prepares for cannot be deleted (remove it from the package first), so a published package never points at nothing.
 */
export function FacultiesEditor({ faculties, onChange, usedDirectionIds }: { faculties: UniversityFaculty[]; onChange: (next: UniversityFaculty[]) => void; usedDirectionIds: Set<string> }) {
  const { t } = useT()
  const setFaculty = (id: string, patch: Partial<UniversityFaculty>) => onChange(faculties.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  return (
    <div className="space-y-3">
      {faculties.map((f) => {
        const facultyUsed = f.directions.some((d) => usedDirectionIds.has(d.id))
        return (
          <div key={f.id} className="rounded-card border border-charcoal/10 bg-paper p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1"><LField label={t('admin.uni.facultyName')} value={f.name} onChange={(v) => setFaculty(f.id, { name: v })} /></div>
              <Button size="sm" variant="ghost" className="mt-6" aria-label={t('common.delete')} disabled={facultyUsed} title={facultyUsed ? t('admin.uni.directionInUse') : undefined} onClick={() => { if (confirm(t('common.confirmDelete'))) onChange(faculties.filter((x) => x.id !== f.id)) }}><Icon name="trash" className="h-3.5 w-3.5" /></Button>
            </div>
            <ul className="mt-3 space-y-3 border-l-2 border-sage pl-3">
              {f.directions.map((d) => {
                const used = usedDirectionIds.has(d.id)
                const setDirection = (patch: Partial<typeof d>) => setFaculty(f.id, { directions: f.directions.map((x) => (x.id === d.id ? { ...x, ...patch } : x)) })
                return (
                  <li key={d.id} className="rounded-control bg-ivory/60 p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1"><LField label={t('admin.uni.directionName')} value={d.name} onChange={(v) => setDirection({ name: v })} /></div>
                      <Button size="sm" variant="ghost" className="mt-6" aria-label={t('common.delete')} disabled={used} title={used ? t('admin.uni.directionInUse') : undefined} onClick={() => setFaculty(f.id, { directions: f.directions.filter((x) => x.id !== d.id) })}><Icon name="x" className="h-3.5 w-3.5" /></Button>
                    </div>
                    <div className="mt-2 text-xs font-medium text-charcoal/70">{t('admin.uni.directionSubjects')}</div>
                    <ul className="mt-1.5 space-y-2">
                      {d.subjects.map((s, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-3">
                            {(['uz', 'ru', 'en'] as const).map((lg) => (
                              <div key={lg} className="relative">
                                <span className="pointer-events-none absolute left-3 top-2.5 text-[10px] font-semibold tracking-wider text-champagne">{lg.toUpperCase()}</span>
                                <Input aria-label={`${t('admin.uni.directionSubjects')} ${i + 1} ${lg.toUpperCase()}`} className="pl-9" value={s[lg]} onChange={(e) => setDirection({ subjects: d.subjects.map((x, j) => (j === i ? { ...x, [lg]: e.target.value } : x)) })} />
                              </div>
                            ))}
                          </div>
                          <Button size="sm" variant="ghost" aria-label={t('common.delete')} onClick={() => setDirection({ subjects: d.subjects.filter((_, j) => j !== i) })}><Icon name="x" className="h-3.5 w-3.5" /></Button>
                        </li>
                      ))}
                    </ul>
                    {d.subjects.length < MAX_ENTRANCE_SUBJECTS && <Button size="sm" variant="ghost" className="mt-1" onClick={() => setDirection({ subjects: [...d.subjects, emptyL()] })}><Icon name="plus" className="h-4 w-4" />{t('admin.uni.addEntranceSubject')}</Button>}
                  </li>
                )
              })}
            </ul>
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => setFaculty(f.id, { directions: [...f.directions, newDirection(uid('dir'))] })}><Icon name="plus" className="h-4 w-4" />{t('admin.uni.addDirection')}</Button>
          </div>
        )
      })}
      <Button size="sm" variant="secondary" onClick={() => onChange([...faculties, newFaculty(uid('fac'))])}><Icon name="plus" className="h-4 w-4" />{t('admin.uni.addFaculty')}</Button>
    </div>
  )
}
