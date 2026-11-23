import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { useT } from '../../i18n/useT'
import { clamp } from '../../lib/format'
import { Icon } from '../ui'
import { cx } from '../ui/helpers'
import { useInView, useReducedMotion, useWebGL } from './useMedia'

const FurnitureAssembly = lazy(() => import('./FurnitureAssembly'))

/**
 * Scroll-controlled cinematic section (bounded, sticky, native scrolling preserved).
 * Scroll progress 0→1 drives the media: scrolling down advances, up reverses, stopping holds.
 *
 * Media priority:
 *   1. `src` video, scrubbed by currentTime (when a licensed clip is configured and loads)
 *   2. otherwise the Bazis 3D "sketch → object" sequence driven by the same progress
 *   3. no WebGL / reduced motion / video error → poster + 2D line illustration
 */
export function ScrollVideo({ src, poster, heightVh = 280, stages = [], children }: { src: string; poster?: string; heightVh?: number; stages?: string[]; children: ReactNode }) {
  const { t } = useT()
  const reduced = useReducedMotion()
  const webgl = useWebGL()
  const [wrapRef, inView] = useInView<HTMLElement>('300px')
  const videoRef = useRef<HTMLVideoElement>(null)
  const progressRef = useRef(0)
  const [progress, setProgress] = useState(0)
  const [videoState, setVideoState] = useState<'idle' | 'ready' | 'error'>(src ? 'idle' : 'error')
  const [shouldLoad, setShouldLoad] = useState(false)
  const targetTime = useRef(0)
  const raf = useRef(0)

  // Lazy-load: only attach the src once the section is close to the viewport
  useEffect(() => { if (inView && src) setShouldLoad(true) }, [inView, src])

  // Warm the 3D chunk once the section is about a screen and a half away, so the sketch is ready
  // when it scrolls in — not during the first load, where 240 KB of three.js only slows a phone down.
  const [nearRef, near] = useInView<HTMLDivElement>('150% 0px')
  useEffect(() => {
    if (!near || reduced || webgl === false || (src && videoState !== 'error')) return
    void import('./FurnitureAssembly')
  }, [near, reduced, webgl, src, videoState])

  // Scroll → progress
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    let ticking = false
    const update = () => {
      ticking = false
      const rect = el.getBoundingClientRect()
      const total = el.offsetHeight - window.innerHeight
      const p = total > 0 ? clamp(-rect.top / total, 0, 1) : 0
      progressRef.current = p
      setProgress(p)
    }
    const onScroll = () => { if (!ticking && inView) { ticking = true; requestAnimationFrame(update) } }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll) }
  }, [inView, wrapRef])

  // Progress → video time (smoothed; holds when scrolling stops)
  useEffect(() => {
    const v = videoRef.current
    if (!v || videoState !== 'ready' || reduced) return
    targetTime.current = progress * (v.duration || 0)
    const step = () => {
      const cur = v.currentTime
      const next = cur + (targetTime.current - cur) * 0.25
      if (Math.abs(next - cur) > 0.005) {
        v.currentTime = next
        raf.current = requestAnimationFrame(step)
      }
    }
    cancelAnimationFrame(raf.current)
    if (inView) raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [progress, videoState, reduced, inView])

  const showVideo = videoState === 'ready' && !reduced
  const showScene = !showVideo && videoState === 'error' && !reduced && webgl === true
  const stageIndex = stages.length ? Math.min(stages.length - 1, Math.floor(progress * stages.length)) : -1


  return (
    <section ref={wrapRef} className="relative" style={{ height: `${reduced ? 100 : heightVh}vh` }} aria-label="Bazis">
      <div ref={nearRef} className="pointer-events-none absolute inset-x-0 top-0 h-px" aria-hidden="true" />
      <div className="sticky top-0 h-screen overflow-hidden bg-charcoal">
        {/* Media layer */}
        <div className="absolute inset-0">
          <div className="absolute inset-0" style={poster ? { backgroundImage: `url(${poster})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: 'radial-gradient(120% 80% at 75% 45%, #2b3a35 0%, #1b2622 55%, #131917 100%)' }} />
          {shouldLoad && src && videoState !== 'error' && (
            <video
              ref={videoRef}
              src={src}
              poster={poster || undefined}
              muted
              playsInline
              preload="metadata"
              className={cx('absolute inset-0 h-full w-full object-cover transition-opacity duration-700', showVideo ? 'opacity-100' : 'opacity-0')}
              onLoadedMetadata={() => { setVideoState('ready'); if (videoRef.current) videoRef.current.pause() }}
              onError={() => setVideoState('error')}
              aria-hidden="true"
            />
          )}
          {showScene && inView && (
            <div className="absolute inset-0" aria-hidden="true">
              <Suspense fallback={null}>
                <FurnitureAssembly animate={false} progressRef={progressRef} />
              </Suspense>
            </div>
          )}
          {!showVideo && !showScene && <PosterIllustration progress={reduced ? 0.85 : progress} poster={poster} />}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-charcoal/90 via-charcoal/50 to-charcoal/5 lg:via-charcoal/25" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-charcoal/70 to-transparent" />
        </div>
        {/* Copy layer */}
        <div className="container-x relative flex h-full flex-col justify-center py-16">
          <div className="pointer-events-auto max-w-xl text-ivory">{children}</div>
          {stages.length > 0 && (
            <ol className="mt-10 hidden max-w-xs gap-1.5 md:grid" aria-label={t('home.stage')}>
              {stages.map((label, i) => {
                const active = i === stageIndex
                const done = i < stageIndex
                return (
                  <li key={i} className={cx('flex items-center gap-3 text-[13px] transition-all duration-500', active ? 'text-ivory' : done ? 'text-ivory/55' : 'text-ivory/35')}>
                    <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-display text-[12px] transition-all duration-500', active ? 'border-champagne bg-champagne text-charcoal' : done ? 'border-champagne/60 text-champagne' : 'border-ivory/25')}>{done ? <Icon name="check" className="h-3 w-3" /> : i + 1}</span>
                    <span className={cx('transition-transform duration-500', active && 'translate-x-1')}>{label}</span>
                  </li>
                )
              })}
            </ol>
          )}
          {/* Decorative progress line only; technical labels (frame, stage, playback status) are not shown to visitors. */}
          <div className="pointer-events-none absolute inset-x-5 bottom-6 sm:inset-x-8 lg:inset-x-12" aria-hidden="true">
            <span className="relative block h-px w-28 bg-ivory/25"><span className="absolute inset-y-0 left-0 bg-champagne" style={{ width: `${progress * 100}%` }} /></span>
          </div>
        </div>
      </div>
    </section>
  )
}

/** 2D fallback: a scroll-driven line illustration of a chair being drawn/assembled. */
function PosterIllustration({ progress, poster }: { progress: number; poster?: string }) {
  const p = clamp(progress, 0, 1)
  const seg = (a: number, b: number) => clamp((p - a) / (b - a), 0, 1)
  const strokes: { d: string; from: number; to: number; w?: number; c?: string }[] = [
    { d: 'M 300 520 L 300 340', from: 0.0, to: 0.15 },
    { d: 'M 420 520 L 420 340', from: 0.05, to: 0.2 },
    { d: 'M 560 520 L 560 340', from: 0.1, to: 0.25 },
    { d: 'M 680 520 L 680 340', from: 0.15, to: 0.3 },
    { d: 'M 280 340 L 700 340 L 700 322 L 280 322 Z', from: 0.3, to: 0.5, w: 2.2 },
    { d: 'M 300 322 L 300 130', from: 0.5, to: 0.65 },
    { d: 'M 420 322 L 420 130', from: 0.55, to: 0.7 },
    { d: 'M 290 130 L 430 130 L 430 200 L 290 200 Z', from: 0.7, to: 0.88, w: 2.2 },
    { d: 'M 300 420 L 420 420', from: 0.86, to: 0.95, c: '#CA9A36', w: 2.4 },
    { d: 'M 560 420 L 680 420', from: 0.88, to: 0.97, c: '#CA9A36', w: 2.4 },
  ]
  if (poster) return null
  return (
    <svg viewBox="0 0 960 600" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0v40" fill="none" stroke="#FBF3E3" strokeOpacity="0.05" /></pattern>
      </defs>
      <rect width="960" height="600" fill="url(#grid)" />
      <line x1="120" y1="520" x2="860" y2="520" stroke="#CA9A36" strokeOpacity="0.35" />
      {strokes.map((s, i) => {
        const k = seg(s.from, s.to)
        return <path key={i} d={s.d} fill="none" stroke={s.c ?? '#FBF3E3'} strokeWidth={s.w ?? 1.6} strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - k} opacity={0.5 + k * 0.5} />
      })}
      <g opacity={seg(0.35, 0.5)} stroke="#CA9A36" strokeWidth="1">
        <path d="M 280 560 L 700 560 M 280 552 L 280 568 M 700 552 L 700 568" />
        <text x="490" y="585" fill="#CA9A36" fontSize="14" textAnchor="middle" fontFamily="Inter, sans-serif">420 mm</text>
      </g>
      <g opacity={seg(0.7, 0.9)} stroke="#CA9A36" strokeWidth="1">
        <path d="M 760 130 L 760 520 M 752 130 L 768 130 M 752 520 L 768 520" />
        <text x="790" y="330" fill="#CA9A36" fontSize="14" fontFamily="Inter, sans-serif">890 mm</text>
      </g>
      <circle cx="300" cy="420" r={4 * seg(0.86, 0.95)} fill="#CA9A36" />
      <circle cx="420" cy="420" r={4 * seg(0.86, 0.95)} fill="#CA9A36" />
    </svg>
  )
}
