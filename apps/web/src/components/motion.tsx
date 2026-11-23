import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useReducedMotion } from './three/useMedia'
import { Icon } from './ui'
import { cx } from './ui/helpers'

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

/** Horizontal scroll-snap track with previous/next controls. */
export function SnapTrack({ children, prevLabel, nextLabel, className, autoAdvanceMs }: { children: ReactNode; prevLabel: string; nextLabel: string; className?: string; autoAdvanceMs?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const [engaged, setEngaged] = useState(false) // pointer over the track or focus inside it
  const go = (dir: -1 | 1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: 'smooth' })
  // Optional slow auto-advance: off with reduced motion and while the visitor hovers or focuses the track.
  const auto = !!autoAdvanceMs && !reduced
  useEffect(() => {
    if (!auto || engaged) return
    const id = window.setInterval(() => {
      const el = ref.current
      if (!el) return
      if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 4) el.scrollTo({ left: 0, behavior: 'smooth' })
      else el.scrollBy({ left: el.clientWidth * 0.8, behavior: 'smooth' })
    }, autoAdvanceMs)
    return () => window.clearInterval(id)
  }, [auto, engaged, autoAdvanceMs])
  return (
    <div className="relative" onMouseEnter={() => setEngaged(true)} onMouseLeave={() => setEngaged(false)} onFocus={() => setEngaged(true)} onBlur={() => setEngaged(false)}>
      <div ref={ref} className={cx('snap-track no-scrollbar -mx-5 px-5 sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12', className)}>{children}</div>
      <div className="mt-2 flex items-center justify-end gap-2">
        <button type="button" onClick={() => go(-1)} aria-label={prevLabel} className="flex h-10 w-10 items-center justify-center rounded-full border border-charcoal/15 bg-paper text-charcoal transition hover:border-forest hover:text-forest"><Icon name="arrowLeft" className="h-4 w-4" /></button>
        <button type="button" onClick={() => go(1)} aria-label={nextLabel} className="flex h-10 w-10 items-center justify-center rounded-full border border-charcoal/15 bg-paper text-charcoal transition hover:border-forest hover:text-forest"><Icon name="arrowRight" className="h-4 w-4" /></button>
      </div>
    </div>
  )
}

/**
 * Full-bleed muted background film (autoplay / muted / loop / playsInline).
 * - the poster or drifting brand gradient stays underneath while the film loads, on error and with reduced motion
 * - the first decoded frame is shown as soon as it exists; playback starts once enough is buffered to play through
 * - plays on its own and loops without any control; it only rests while offscreen; gentle parallax on scroll
 * - if the browser blocks autoplay (for example iOS Low Power Mode), it starts at the visitor's first tap, key or scroll
 * Readiness is read from the element itself, not only from React's event props: the server-rendered <video>
 * starts buffering before hydration, so loadeddata/canplay may already have fired when the handlers attach.
 */
type FilmState = 'loading' | 'frame' | 'ready' | 'error'
const MEDIA_EVENTS = ['loadeddata', 'canplay', 'canplaythrough', 'playing', 'play', 'pause', 'emptied', 'error'] as const
const GESTURES = ['pointerdown', 'touchstart', 'keydown', 'scroll'] as const

/** Touch-first or narrow screens (phones): skip the scroll parallax there — it repaints the playing film on every scroll frame. */
const isPhoneLike = () => typeof matchMedia !== 'undefined' && matchMedia('(hover: none), (max-width: 767px)').matches

export function BackgroundVideo({ src, poster, note, rate = 1 }: { src: string; poster?: string; note?: string; rate?: number }) {
  const ref = useRef<HTMLVideoElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const [state, setState] = useState<FilmState>('loading')
  const [blocked, setBlocked] = useState(false)
  const [inView, setInView] = useState(true)

  // Readiness from the element: 'frame' = first frame decoded, 'ready' = can play through (or already playing)
  useEffect(() => {
    const v = ref.current
    if (!v || !src) return
    const sync = () => {
      // Playback speed is reset by the browser when a new source loads, so keep it on every sync.
      if (v.playbackRate !== rate) { v.defaultPlaybackRate = rate; v.playbackRate = rate }
      if (v.error) setState('error')
      else if (!v.paused || v.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) setState('ready')
      else if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) setState('frame')
      else setState('loading')
    }
    sync()
    for (const e of MEDIA_EVENTS) v.addEventListener(e, sync)
    return () => { for (const e of MEDIA_EVENTS) v.removeEventListener(e, sync) }
  }, [src, rate])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.05 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Play/pause according to buffering, visibility and reduced motion.
  // While only the first frame is in ('frame'), the browser's own autoplay takes over once it can play through.
  const wantPlay = state === 'ready' && !reduced && inView
  const shouldPlay = useRef(false)
  useEffect(() => { shouldPlay.current = wantPlay }, [wantPlay])
  useEffect(() => {
    const v = ref.current
    if (!v || state === 'loading' || state === 'error') return
    if (wantPlay) v.play().then(() => setBlocked(false)).catch((err: unknown) => { if ((err as { name?: string })?.name === 'NotAllowedError') setBlocked(true) })
    else if (state === 'ready' || reduced) v.pause()
  }, [wantPlay, state, reduced])

  // Autoplay refused by the browser: start at the first interaction with the page instead of offering a button.
  useEffect(() => {
    if (!blocked) return
    const start = () => { const v = ref.current; if (v && shouldPlay.current) v.play().then(() => setBlocked(false)).catch(() => {}) }
    for (const g of GESTURES) window.addEventListener(g, start, { passive: true })
    return () => { for (const g of GESTURES) window.removeEventListener(g, start) }
  }, [blocked])

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
    if (!v || reduced || isPhoneLike()) return
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

  const showVideo = (state === 'frame' || state === 'ready') && !reduced
  return (
    <div ref={wrap} className="absolute inset-0 overflow-hidden">
      {/* Fallback: poster or the drifting brand-green gradient, kept underneath while loading / on error / with reduced motion */}
      {/* The drifting gradient repaints the whole hero every frame: it only moves while it is actually seen (film not shown yet, hero on screen). */}
      <div className={cx('absolute inset-0', poster ? 'bg-cover bg-center' : 'hero-fallback')} style={poster ? { backgroundImage: `url(${poster})` } : { animationPlayState: showVideo || !inView ? 'paused' : 'running' }} aria-hidden="true" />
      {src && state !== 'error' && (
        <video
          ref={ref}
          src={src}
          poster={poster || undefined}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          aria-hidden="true"
          tabIndex={-1}
          className={cx('absolute inset-0 h-full w-full object-cover transition-opacity duration-1000', showVideo ? 'opacity-100' : 'opacity-0')}
          style={{ transform: 'scale(1.06)' }}
        />
      )}
      {showVideo && note && <span className="sr-only">{note}</span>}
    </div>
  )
}
