import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useReducedMotion } from './three/useMedia'
import { cx, Icon } from './ui'

/** Counts from 0 to `value` when scrolled into view. Reduced motion → static value. */
export function CountUp({ value, duration = 1400, className }: { value: number; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduced = useReducedMotion()
  const [n, setN] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (reduced) { setN(value); return }
    let raf = 0
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      const start = performance.now()
      const step = (t: number) => {
        const k = Math.min(1, (t - start) / duration)
        setN(Math.round(value * (1 - Math.pow(1 - k, 3))))
        if (k < 1) raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }, { threshold: 0.4 })
    io.observe(el)
    return () => { io.disconnect(); cancelAnimationFrame(raf) }
  }, [value, duration, reduced])
  return <span ref={ref} className={className}>{n}</span>
}

/** Headline entrance: each word rises from a clipped line, staggered. Screen readers get the plain text. */
export function SplitWords({ text, className, baseDelay = 0.1, step = 0.06 }: { text: string; className?: string; baseDelay?: number; step?: number }) {
  const words = text.split(/\s+/).filter(Boolean)
  return (
    <span className={cx('word-rise', className)}>
      {words.map((w, i) => (
        <span key={i} className="w">
          <span style={{ '--d': `${baseDelay + i * step}s` } as CSSProperties}>{w}</span>
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  )
}

/** Infinite ticker; the list is duplicated for a seamless loop and pauses on hover/focus. */
export function Marquee({ items, label, className }: { items: ReactNode[]; label?: string; className?: string }) {
  const row = [...items, ...items]
  return (
    <div className={cx('marquee-wrap', className)} aria-label={label}>
      <div className="marquee">
        {row.map((it, i) => (
          <span key={i} className="flex shrink-0 items-center gap-8 pr-8" aria-hidden={i >= items.length}>
            {it}
            <span className="h-1 w-1 rounded-full bg-champagne" />
          </span>
        ))}
      </div>
    </div>
  )
}

/** Horizontal scroll-snap track with previous/next controls. */
export function SnapTrack({ children, prevLabel, nextLabel, className }: { children: ReactNode; prevLabel: string; nextLabel: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const go = (dir: -1 | 1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: 'smooth' })
  return (
    <div className="relative">
      <div ref={ref} className={cx('snap-track no-scrollbar -mx-5 px-5 sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12', className)}>{children}</div>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={() => go(-1)} aria-label={prevLabel} className="flex h-10 w-10 items-center justify-center rounded-full border border-charcoal/15 bg-paper text-charcoal transition hover:border-forest hover:text-forest"><Icon name="arrowLeft" className="h-4 w-4" /></button>
        <button type="button" onClick={() => go(1)} aria-label={nextLabel} className="flex h-10 w-10 items-center justify-center rounded-full border border-charcoal/15 bg-paper text-charcoal transition hover:border-forest hover:text-forest"><Icon name="arrowRight" className="h-4 w-4" /></button>
      </div>
    </div>
  )
}

/**
 * Full-bleed muted background film.
 * - autoplay/loop/muted/playsInline, paused while offscreen, gentle parallax on scroll
 * - poster or drifting brand gradient while loading / on error / with reduced motion
 * - visible pause/play control for accessibility
 */
export function BackgroundVideo({ src, poster, pauseLabel, playLabel, note }: { src: string; poster?: string; pauseLabel: string; playLabel: string; note?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [paused, setPaused] = useState(false)
  const [inView, setInView] = useState(true)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.05 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Play/pause according to visibility, user choice and reduced motion
  const shouldPlay = useRef(false)
  shouldPlay.current = state === 'ready' && !reduced && !paused && inView
  useEffect(() => {
    const v = ref.current
    if (!v || state !== 'ready') return
    if (!shouldPlay.current) v.pause()
    else v.play().catch(() => setPaused(true))
  }, [state, reduced, paused, inView])

  // Keep-alive: if something outside the component pauses the film (tab switch, capture,
  // power saving) while it should be playing, resume once the document is visible again.
  useEffect(() => {
    const v = ref.current
    if (!v) return
    let timer = 0
    const resume = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => { if (shouldPlay.current && v.paused && !document.hidden) v.play().catch(() => {}) }, 300)
    }
    v.addEventListener('pause', resume)
    document.addEventListener('visibilitychange', resume)
    return () => { window.clearTimeout(timer); v.removeEventListener('pause', resume); document.removeEventListener('visibilitychange', resume) }
  }, [])

  // Subtle parallax while the hero is on screen
  useEffect(() => {
    const v = ref.current
    if (!v || reduced) return
    let raf = 0
    const onScroll = () => {
      if (!inView) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => { v.style.transform = `translate3d(0, ${Math.min(window.scrollY, 900) * 0.18}px, 0) scale(1.06)` })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf) }
  }, [inView, reduced])

  const showVideo = state === 'ready' && !reduced
  return (
    <div ref={wrap} className="absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className={cx('absolute inset-0', poster ? 'bg-cover bg-center' : 'hero-fallback')} style={poster ? { backgroundImage: `url(${poster})` } : undefined} />
      {src && state !== 'error' && (
        <video
          ref={ref}
          src={src}
          poster={poster || undefined}
          muted
          loop
          playsInline
          autoPlay={!reduced}
          preload="auto"
          onCanPlay={() => setState('ready')}
          onError={() => setState('error')}
          className={cx('absolute inset-0 h-full w-full object-cover transition-opacity duration-1000', showVideo ? 'opacity-100' : 'opacity-0')}
          style={{ transform: 'scale(1.06)' }}
        />
      )}
      {state === 'ready' && !reduced && (
        <div className="pointer-events-auto absolute bottom-6 right-5 z-10 flex items-center gap-3 sm:right-8 lg:right-12">
          {note && <span className="sr-only">{note}</span>}
          <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? playLabel : pauseLabel} aria-pressed={paused} className="flex h-10 w-10 items-center justify-center rounded-full border border-ivory/30 bg-charcoal/40 text-ivory backdrop-blur transition hover:bg-charcoal/60">
            {paused ? <Icon name="play" className="h-4 w-4" /> : <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>}
          </button>
        </div>
      )}
    </div>
  )
}
