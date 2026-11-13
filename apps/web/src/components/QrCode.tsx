import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { cx } from './ui/helpers'

/** Real QR code (qrcode library) rendered as an image; `value` is the full attendance URL. */
export function QrCode({ value, size = 280, className, label }: { value: string; size?: number; className?: string; label?: string }) {
  const [src, setSrc] = useState<string>('')
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#163C35', light: '#FFFFFF' } })
      .then((url) => { if (!cancelled) { setSrc(url); setError(false) } })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [value, size])
  if (error) return <div className={cx('flex items-center justify-center rounded-card bg-sage text-xs text-charcoal/60', className)} style={{ width: size, height: size }}>QR</div>
  return src ? (
    <img src={src} width={size} height={size} alt={label ?? value} className={cx('rounded-card bg-paper', className)} />
  ) : (
    <div className={cx('animate-pulse rounded-card bg-sage/60', className)} style={{ width: size, height: size }} aria-hidden="true" />
  )
}
