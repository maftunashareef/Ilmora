'use client'
import { useCallback, useState, type ReactNode } from 'react'
import { useT } from '@/i18n/useT'
import { Button, Icon, Modal, Notice } from './ui'

/**
 * A temporary password from the API, shown once (a new ministry account, «Новый пароль», «Сбросить пароль»): the login
 * and the password with a copy button, a warning to hand it over in person, and a mark that it was handed over — the
 * dialog does not close before that mark (Esc, the cross and the backdrop included).
 */
export function TemporaryPasswordDialog({ title, name, login, password, note, handedLabel, onClose }: {
  title: string
  name: string
  login: string
  password: string
  /** What happens next for the owner (e.g. the QR code at the first sign-in, or the change of the password). */
  note?: ReactNode
  handedLabel: string
  onClose: () => void
}) {
  const { t } = useT()
  const [copied, setCopied] = useState(false)
  const [handed, setHanded] = useState(false)
  const close = useCallback(() => { if (handed) onClose() }, [handed, onClose])
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${login}\n${password}`); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* the text stays on screen to copy by hand */ }
  }
  return (
    <Modal open onClose={close} title={title} footer={<div className="flex justify-end"><Button disabled={!handed} onClick={onClose}>{t('mfa.continue')}</Button></div>}>
      <div className="space-y-4">
        <p className="text-sm text-charcoal/75">{name}</p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 rounded-control border border-charcoal/12 bg-ivory/60 p-4 text-sm">
          <dt className="text-charcoal/55">{t('auth.login')}</dt><dd className="select-all font-mono text-charcoal">{login}</dd>
          <dt className="text-charcoal/55">{t('admin.ministry.passwordTitle')}</dt><dd className="select-all break-all font-mono text-base tracking-wider text-charcoal">{password}</dd>
        </dl>
        <Button type="button" size="sm" variant="secondary" onClick={() => void copy()}><Icon name={copied ? 'check' : 'file'} className="h-3.5 w-3.5" />{t(copied ? 'mfa.copied' : 'admin.ministry.copyBoth')}</Button>
        <Notice tone="warn" className="text-xs">{t('admin.ministry.passwordOnce')}</Notice>
        {note && <p className="text-xs leading-relaxed text-charcoal/65">{note}</p>}
        <label className="flex cursor-pointer items-start gap-3 text-[13px] text-charcoal/80">
          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-forest" checked={handed} onChange={(e) => setHanded(e.target.checked)} />
          <span>{handedLabel}</span>
        </label>
      </div>
    </Modal>
  )
}
