import { useRef } from 'react'
import { useT } from '../i18n/useT'
import { formatBytes } from '../lib/format'
import type { UploadMeta } from '../types'
import { Button, Icon, Notice } from './ui'

/**
 * Honest local upload: creates an object URL for preview and records metadata.
 * Nothing is sent anywhere; the preview URL is transient and dropped from persistence.
 */
export function UploadField({ value, onChange, accept, label, kind = 'file' }: { value?: UploadMeta; onChange: (v: UploadMeta | undefined) => void; accept?: string; label?: string; kind?: 'image' | 'video' | 'file' }) {
  const { t } = useT()
  const ref = useRef<HTMLInputElement>(null)
  const handle = (file: File | undefined) => {
    if (!file) return
    if (value?.previewUrl) URL.revokeObjectURL(value.previewUrl)
    onChange({ name: file.name, size: file.size, mime: file.type || 'application/octet-stream', previewUrl: URL.createObjectURL(file) })
  }
  return (
    <div className="space-y-2">
      <input ref={ref} type="file" accept={accept} className="sr-only" onChange={(e) => handle(e.target.files?.[0])} aria-label={label ?? t('common.upload')} />
      {!value ? (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handle(e.dataTransfer.files?.[0]) }}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-card border border-dashed border-charcoal/20 bg-ivory/60 px-4 py-8 text-sm text-charcoal/60 transition hover:border-forest/50 hover:text-forest"
        >
          <Icon name="upload" className="h-5 w-5" />
          <span>{label ?? t('common.upload')}</span>
        </button>
      ) : (
        <div className="flex items-start gap-3 rounded-card border border-charcoal/10 bg-paper p-3">
          {kind === 'image' && value.previewUrl && <img src={value.previewUrl} alt="" className="h-16 w-24 rounded-control object-cover" />}
          {kind === 'video' && value.previewUrl && <video src={value.previewUrl} className="h-16 w-24 rounded-control bg-charcoal object-cover" muted />}
          {(!value.previewUrl || kind === 'file') && <span className="flex h-16 w-24 items-center justify-center rounded-control bg-sage text-forest"><Icon name="file" className="h-6 w-6" /></span>}
          <div className="min-w-0 flex-1 text-xs">
            <div className="truncate font-medium text-charcoal">{value.name}</div>
            <div className="mt-0.5 text-charcoal/55">{value.mime} · {formatBytes(value.size)}</div>
            {!value.previewUrl && <div className="mt-1 text-[11px] text-amber-800">{t('channel.previewLost')}</div>}
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => ref.current?.click()}>{t('common.upload')}</Button>
              <Button size="sm" variant="ghost" onClick={() => { if (value.previewUrl) URL.revokeObjectURL(value.previewUrl); onChange(undefined) }}>{t('common.remove')}</Button>
            </div>
          </div>
        </div>
      )}
      <Notice tone="info" className="text-[12px]">{t('studio.uploadNote')}</Notice>
    </div>
  )
}
