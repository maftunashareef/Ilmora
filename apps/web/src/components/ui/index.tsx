import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Link } from '@/lib/router'
import { useT } from '../../i18n/useT'
import type { L, Lang } from '../../types'
import { LANGS } from '../../i18n/translations'

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

// ─── Button ──────────────────────────────────────────────────────────────────
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'champagne'
type Size = 'sm' | 'md' | 'lg'

const variantCls: Record<Variant, string> = {
  primary: 'bg-forest text-ivory hover:bg-forest/90 border border-forest',
  secondary: 'bg-paper text-charcoal border border-charcoal/15 hover:border-forest/50 hover:text-forest',
  ghost: 'bg-transparent text-charcoal/80 hover:text-forest hover:bg-forest/5 border border-transparent',
  danger: 'bg-transparent text-red-800 border border-red-800/20 hover:bg-red-50',
  champagne: 'bg-champagne text-charcoal hover:brightness-95 border border-champagne',
}
const sizeCls: Record<Size, string> = {
  sm: 'text-xs px-3 py-1.5 gap-1.5',
  md: 'text-sm px-4.5 py-2.5 gap-2',
  lg: 'text-[15px] px-6 py-3.5 gap-2.5',
}

export function Button({ variant = 'primary', size = 'md', className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type="button"
      className={cx('arrow-nudge inline-flex items-center justify-center rounded-control font-medium tracking-tight transition duration-200 disabled:opacity-40 disabled:cursor-not-allowed', variantCls[variant], sizeCls[size], className)}
      {...rest}
    >
      {children}
    </button>
  )
}

export function LinkButton({ to, variant = 'primary', size = 'md', className, children, external }: { to: string; variant?: Variant; size?: Size; className?: string; children: ReactNode; external?: boolean }) {
  const cls = cx('arrow-nudge inline-flex items-center justify-center rounded-control font-medium tracking-tight transition duration-200', variantCls[variant], sizeCls[size], className)
  if (external) return <a href={to} target="_blank" rel="noreferrer" className={cls}>{children}</a>
  return <Link to={to} className={cls}>{children}</Link>
}

// ─── Inputs ──────────────────────────────────────────────────────────────────
const fieldBase = 'w-full rounded-control border border-charcoal/15 bg-paper px-3.5 py-2.5 text-sm text-charcoal placeholder:text-charcoal/35 focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/15 transition disabled:bg-sage/40 disabled:text-charcoal/50'

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(fieldBase, props.className)} />
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cx(fieldBase, 'leading-relaxed', props.className)} />
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(fieldBase, 'pr-9 appearance-none bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%23202725%27 stroke-width=%272%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E")] bg-[length:12px] bg-[right_0.9rem_center] bg-no-repeat', props.className)} />
}

export function Field({ label, hint, children, required, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; required?: boolean; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 flex items-baseline justify-between gap-3 text-xs font-medium text-charcoal/70">
        <span>{label}{required && <span className="ml-0.5 text-champagne">*</span>}</span>
        {hint && <span className="text-[11px] font-normal text-charcoal/45">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

/** Three-language text field (UZ / RU / EN) editing a single L value. */
export function LField({ label, value, onChange, multiline, required, hint }: { label: ReactNode; value: L; onChange: (v: L) => void; multiline?: boolean; required?: boolean; hint?: ReactNode }) {
  return (
    <div>
      <span className="mb-1.5 flex items-baseline justify-between gap-3 text-xs font-medium text-charcoal/70">
        <span>{label}{required && <span className="ml-0.5 text-champagne">*</span>}</span>
        {hint && <span className="text-[11px] font-normal text-charcoal/45">{hint}</span>}
      </span>
      <div className="grid gap-2 sm:grid-cols-3">
        {LANGS.map((lg) => (
          <div key={lg.code} className="relative">
            <span className="pointer-events-none absolute left-3 top-2.5 text-[10px] font-semibold tracking-wider text-champagne">{lg.short}</span>
            {multiline ? (
              <Textarea aria-label={`${typeof label === 'string' ? label : ''} ${lg.label}`} className="pl-10" value={value?.[lg.code] ?? ''} onChange={(e) => onChange({ ...value, [lg.code]: e.target.value })} />
            ) : (
              <Input aria-label={`${typeof label === 'string' ? label : ''} ${lg.label}`} className="pl-10" value={value?.[lg.code] ?? ''} onChange={(e) => onChange({ ...value, [lg.code]: e.target.value })} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId()
  return (
    <div className={cx('flex items-start justify-between gap-4', disabled && 'opacity-50')}>
      {(label || description) && (
        <label htmlFor={id} className="cursor-pointer">
          {label && <div className="text-sm font-medium text-charcoal">{label}</div>}
          {description && <div className="mt-0.5 text-xs text-charcoal/55">{description}</div>}
        </label>
      )}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative h-6 w-11 shrink-0 rounded-full border transition', checked ? 'bg-forest border-forest' : 'bg-sage border-charcoal/15')}
      >
        <span className={cx('absolute top-0.5 h-[18px] w-[18px] rounded-full bg-paper shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </div>
  )
}

// ─── Badges ──────────────────────────────────────────────────────────────────
export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'forest' | 'champagne' | 'sage' | 'warn' | 'muted' | 'danger'; className?: string }) {
  const tones = {
    neutral: 'bg-paper text-charcoal/80 border-charcoal/15',
    forest: 'bg-forest text-ivory border-forest',
    champagne: 'bg-champagne/25 text-charcoal border-champagne/60',
    sage: 'bg-sage text-forest border-sage',
    warn: 'bg-amber-50 text-amber-900 border-amber-200',
    danger: 'bg-red-50 text-red-900 border-red-200',
    muted: 'bg-charcoal/5 text-charcoal/55 border-transparent',
  }
  return <span className={cx('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide whitespace-nowrap', tones[tone], className)}>{children}</span>
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('eyebrow', className)}>{children}</div>
}

export function SectionHeading({ eyebrow, title, subtitle, align = 'left', action }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; align?: 'left' | 'center'; action?: ReactNode }) {
  return (
    <div className={cx('reveal mb-10 flex flex-col gap-4 md:mb-14', align === 'center' ? 'items-center text-center' : 'md:flex-row md:items-end md:justify-between')}>
      <div className={cx('max-w-2xl', align === 'center' && 'mx-auto')}>
        {eyebrow && <Eyebrow className="mb-3">{eyebrow}</Eyebrow>}
        <h2 className="font-display text-3xl leading-[1.1] text-charcoal md:text-5xl">{title}</h2>
        {subtitle && <p className="mt-4 text-[15px] leading-relaxed text-charcoal/65 md:text-base">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function PageTitle({ eyebrow, title, subtitle, action }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="reveal mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl">
        {eyebrow && <Eyebrow className="mb-2">{eyebrow}</Eyebrow>}
        <h1 className="font-display text-3xl leading-tight text-charcoal md:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 text-sm leading-relaxed text-charcoal/60 md:text-[15px]">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0 flex flex-wrap gap-2">{action}</div>}
    </div>
  )
}

export function Card({ children, className, as: Tag = 'div', padded = true }: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'article' | 'li'; padded?: boolean }) {
  return <Tag className={cx('card transition-all duration-300', padded && 'p-5 md:p-6', className)}>{children}</Tag>
}

export function EmptyState({ title, body, action, icon }: { title: ReactNode; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center px-6 py-14 text-center border-dashed border-charcoal/20 bg-ivory/30">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-sage/60 text-forest shadow-xs">{icon ?? <span className="font-display text-2xl">·</span>}</div>
      <h3 className="font-display text-2xl text-charcoal">{title}</h3>
      {body && <p className="mt-2 max-w-md text-sm text-charcoal/65 leading-relaxed">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

export function Notice({ children, tone = 'info', className }: { children: ReactNode; tone?: 'info' | 'warn' | 'ok'; className?: string }) {
  const t = {
    info: 'bg-sage/60 text-forest border-forest/10',
    warn: 'bg-amber-50 text-amber-900 border-amber-200',
    ok: 'bg-forest text-ivory border-forest',
  }
  return <div className={cx('rounded-control border px-4 py-3 text-[13px] leading-relaxed', t[tone], className)}>{children}</div>
}

export function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="reveal card relative overflow-hidden p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lift border border-charcoal/10 hover:border-champagne/40">
      <div className="text-xs font-semibold uppercase tracking-wider text-charcoal/50">{label}</div>
      <div className="mt-2 font-display text-3xl text-charcoal tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-charcoal/50">{hint}</div>}
      <div className="pointer-events-none absolute bottom-0 inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-champagne/40 to-transparent" />
    </div>
  )
}

// ─── Modal ───────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const { t } = useT()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button')
    first?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-charcoal/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" className={cx('animate-rise flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-card bg-paper shadow-lift sm:rounded-card', wide ? 'sm:max-w-4xl' : 'sm:max-w-2xl')}>
        <div className="flex items-center justify-between gap-4 border-b border-charcoal/10 px-6 py-4">
          <h2 className="font-display text-2xl text-charcoal">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="rounded-full p-2 text-charcoal/60 hover:bg-sage hover:text-forest">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-charcoal/10 bg-ivory/60 px-6 py-4">{footer}</div>}
      </div>
    </div>
  )
}

// ─── Tabs ────────────────────────────────────────────────────────────────────
export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx('scrollbar-thin flex gap-1 overflow-x-auto border-b border-charcoal/10', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={cx('relative -mb-px whitespace-nowrap px-4 py-3 text-sm font-medium transition', value === tab.id ? 'text-forest' : 'text-charcoal/55 hover:text-charcoal')}
        >
          {tab.label}
          {tab.count !== undefined && <span className="ml-1.5 text-[11px] text-charcoal/40">{tab.count}</span>}
          {value === tab.id && <span className="absolute inset-x-3 bottom-0 h-[2px] bg-forest" />}
        </button>
      ))}
    </div>
  )
}

export function Segmented<T extends string>({ options, value, onChange, size = 'md' }: { options: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded-control border border-charcoal/12 bg-paper p-0.5">
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)} className={cx('rounded-[calc(var(--r-control)-2px)] font-medium transition', size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm', value === o.id ? 'bg-forest text-ivory' : 'text-charcoal/65 hover:text-charcoal')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ─── Generated cover art (no external imagery; deterministic per seed) ───────
const PALETTES = [
  ['#163C35', '#4E6E68', '#C8AD7F'],
  ['#6B4F3A', '#A67C52', '#E3EBE5'],
  ['#202725', '#163C35', '#C8AD7F'],
  ['#8A9A7B', '#163C35', '#F7F5F0'],
  ['#4E6E68', '#E3EBE5', '#C8AD7F'],
  ['#A67C52', '#F7F5F0', '#163C35'],
]

export function ArtCover({ seed, className, label, imageUrl, alt = '', tone }: { seed: number; className?: string; label?: string; imageUrl?: string; alt?: string; tone?: string }) {
  const p = PALETTES[seed % PALETTES.length]
  const r = (n: number) => ((seed * 9301 + n * 49297) % 233280) / 233280
  const base = tone ?? p[0]
  if (imageUrl) {
    return (
      <div className={cx('relative overflow-hidden bg-sage/20', className)}>
        <img src={imageUrl} alt={alt} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
      </div>
    )
  }
  return (
    <div className={cx('relative overflow-hidden', className)} style={{ background: `linear-gradient(135deg, ${base} 0%, ${p[1]} 100%)` }} aria-hidden="true">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id={`g${seed}`} cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor={p[2]} stopOpacity="0.55" />
            <stop offset="100%" stopColor={p[2]} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={80 + r(1) * 240} cy={60 + r(2) * 140} r={90 + r(3) * 60} fill={`url(#g${seed})`} />
        <g fill="none" stroke={p[2]} strokeOpacity="0.55" strokeWidth="0.8">
          {Array.from({ length: 7 }).map((_, i) => (
            <path key={i} d={`M ${-40 + i * 12} ${40 + i * 26 + r(i) * 30} C 120 ${10 + i * 30}, 260 ${120 + i * 14}, 440 ${30 + i * 28}`} />
          ))}
        </g>
        <rect x={40 + r(5) * 200} y={150 + r(6) * 60} width={90 + r(7) * 60} height="1" fill={p[2]} opacity="0.9" />
        <circle cx={330 - r(8) * 60} cy={70 + r(9) * 40} r="3" fill={p[2]} />
        <rect x={300 - r(10) * 100} y={180 - r(11) * 60} width="42" height="42" fill="none" stroke={p[2]} strokeOpacity="0.5" transform={`rotate(${r(12) * 40} 320 200)`} />
      </svg>
      {label && <span className="absolute left-4 top-4 font-display text-3xl text-ivory/80">{label}</span>}
    </div>
  )
}

export function Avatar({
  name,
  seed = 0,
  size = 40,
  url,
  alt,
  className,
}: {
  name: string
  seed?: number
  size?: number
  url?: string | null
  alt?: string
  className?: string
}) {
  const [loadFailed, setLoadFailed] = useState(false)
  useEffect(() => {
    setLoadFailed(false)
  }, [url])

  const ini = name
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase())
    .join('')
  const label = alt ?? name

  if (url && !loadFailed) {
    return (
      <span
        role="img"
        aria-label={label}
        className={cx(
          'group/avatar inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-sage/60 ring-1 ring-charcoal/10 transition-transform duration-300',
          className,
        )}
        style={{ width: size, height: size }}
      >
        <img
          src={url}
          alt={label}
          loading="lazy"
          onError={() => setLoadFailed(true)}
          className="h-full w-full object-cover transition-transform duration-300 group-hover/avatar:scale-105"
        />
      </span>
    )
  }

  void seed
  return (
    <span
      role="img"
      aria-label={label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-forest/15 bg-sage font-display font-medium text-forest transition-all duration-300',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(12, size * 0.38),
        background: 'linear-gradient(145deg, #E3EBE5 0%, #D5E1D8 100%)',
      }}
    >
      {ini || (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-1/2 w-1/2 text-forest/70"
          aria-hidden="true"
        >
          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      )}
    </span>
  )
}

export const langName = (l: Lang) => LANGS.find((x) => x.code === l)?.label ?? l

export function Icon({ name, className = 'h-4 w-4' }: { name: string; className?: string }) {
  const paths: Record<string, ReactNode> = {
    check: <path d="M20 6 9 17l-5-5" />,
    x: <path d="M18 6 6 18M6 6l12 12" />,
    plus: <path d="M12 5v14M5 12h14" />,
    arrowRight: <path d="M5 12h14m-6-6 6 6-6 6" />,
    arrowLeft: <path d="M19 12H5m6 6-6-6 6-6" />,
    up: <path d="m18 15-6-6-6 6" />,
    down: <path d="m6 9 6 6 6-6" />,
    lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    eyeOff: <><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" x2="22" y1="2" y2="22" /></>,
    play: <path d="M6 4v16l14-8z" />,
    file: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></>,
    list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
    bookmark: <path d="M6 3h12v18l-6-4-6 4z" />,
    bookmarkFill: <path d="M6 3h12v18l-6-4-6 4z" fill="currentColor" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
    edit: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />,
    warn: <><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></>,
    external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>,
    upload: <><path d="M12 16V4m0 0-4 4m4-4 4 4" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    home: <path d="M3 11 12 3l9 8v10h-6v-6H9v6H3z" />,
    layers: <path d="m12 3 9 5-9 5-9-5 9-5ZM3 13l9 5 9-5M3 17l9 5 9-5" />,
    palette: <><circle cx="12" cy="12" r="9" /><circle cx="8" cy="10" r="1.2" fill="currentColor" /><circle cx="12" cy="7" r="1.2" fill="currentColor" /><circle cx="16" cy="10" r="1.2" fill="currentColor" /><path d="M12 21c0-3 2-4 4-4h2a3 3 0 0 0 3-3" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
    users: <><circle cx="9" cy="8" r="3.5" /><path d="M2 20a7 7 0 0 1 14 0M16 4a3.5 3.5 0 0 1 0 7M22 20a7 7 0 0 0-5-6.7" /></>,
    building: <><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" /></>,
    package: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="M4 7.5 12 12l8-4.5M12 12v9" /></>,
    shield: <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" />,
    megaphone: <><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" /><path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12" /></>,
    star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" />,
    archive: <><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" /></>,
    refresh: <><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></>,
    video: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" /></>,
    book: <><path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z" /><path d="M20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z" /></>,
    sparkle: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />,
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] ?? <circle cx="12" cy="12" r="4" />}
    </svg>
  )
}
