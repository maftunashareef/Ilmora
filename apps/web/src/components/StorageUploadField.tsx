'use client'
import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n/useT'
import { formatBytes } from '../lib/format'
import { isStorageUnavailable, UPLOAD_RULES, type UploadKind, type UploadResult, uploadToStorage } from '../services/uploads'
import { useStore } from '../store/useStore'
import { Button, Icon, Notice } from './ui'

/**
 * Upload control for studio files (course images, thumbnails, banners, avatars, resource files). The file goes to object
 * storage through a presigned PUT and `onUploaded` receives its public address; nothing is kept as a `blob:` preview.
 * When the environment has no storage the control disappears and a short hint takes its place.
 */
export function StorageUploadField({ kind, url, fileName, label, onUploaded, onRemove }: {
  kind: UploadKind
  /** Address of the current file, shown as the preview; empty when nothing is attached yet. */
  url?: string | null
  /** Shown instead of the address for files without a visual preview. */
  fileName?: string | null
  label?: string
  onUploaded: (result: UploadResult) => void
  onRemove?: () => void
}) {
  const { t } = useT()
  const configured = useStore((s) => s.storageConfigured)
  const ensureStorageStatus = useStore((s) => s.ensureStorageStatus)
  const setStorageConfigured = useStore((s) => s.setStorageConfigured)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const rules = UPLOAD_RULES[kind]

  useEffect(() => {
    if (configured === null) void ensureStorageStatus()
  }, [configured, ensureStorageStatus])

  const upload = async (file: File | undefined) => {
    if (!file) return
    setError('')
    if (!rules.types.includes(file.type)) { setError(t('studio.upload.badType', { types: rules.extensions.join(', ') })); return }
    if (file.size > rules.maxBytes) { setError(t('studio.upload.tooLarge', { max: formatBytes(rules.maxBytes) })); return }
    setBusy(true)
    try {
      onUploaded(await uploadToStorage(kind, file))
    } catch (err) {
      if (isStorageUnavailable(err)) setStorageConfigured(false)
      else setError(t('studio.upload.failed'))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  if (configured === false) return <Notice tone="warn" className="text-[12px]">{t('studio.upload.unavailable')}</Notice>
  const disabled = busy || configured === null
  const icon = <Icon name={busy ? 'refresh' : 'upload'} className={busy ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
  return (
    <div className="space-y-2">
      <input ref={input} type="file" accept={rules.types.join(',')} className="sr-only" aria-label={label ?? t('common.upload')} onChange={(e) => void upload(e.target.files?.[0])} />
      {url ? (
        <div className="flex items-start gap-3 rounded-card border border-charcoal/10 bg-paper p-3">
          {rules.preview === 'image' ? (
            <img src={url} alt="" className="h-16 w-24 rounded-control object-cover" />
          ) : (
            <span className="flex h-16 w-24 shrink-0 items-center justify-center rounded-control bg-sage text-forest"><Icon name="file" className="h-6 w-6" /></span>
          )}
          <div className="min-w-0 flex-1 text-xs">
            <div className="truncate font-medium text-charcoal">{fileName || url}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={disabled} onClick={() => input.current?.click()}>{icon}{busy ? t('studio.upload.uploading') : t('studio.upload.replace')}</Button>
              {onRemove && <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove}>{t('common.remove')}</Button>}
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); void upload(e.dataTransfer.files?.[0]) }}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-card border border-dashed border-charcoal/20 bg-ivory/60 px-4 py-8 text-sm text-charcoal/60 transition hover:border-forest/50 hover:text-forest disabled:opacity-60"
        >
          {icon}
          <span>{busy ? t('studio.upload.uploading') : label ?? t('common.upload')}</span>
          <span className="text-[11px] text-charcoal/45">{rules.extensions.join(', ')} · {formatBytes(rules.maxBytes)}</span>
        </button>
      )}
      {error && <p className="text-[11px] text-red-700" role="alert">{error}</p>}
      <Notice tone="info" className="text-[12px]">{t('studio.upload.note')}</Notice>
    </div>
  )
}
