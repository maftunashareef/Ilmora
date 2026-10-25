import { lazy, Suspense } from 'react'
import { useStore } from '../../store/useStore'
import { cx, Icon } from '../ui'
import { useInView, useReducedMotion, useWebGL } from './useMedia'

const Hero3DCanvas = lazy(() => import('./Hero3DCanvas'))

export function HeroScene3D({ className, caption }: { className?: string; caption?: string }) {
  const enabled = useStore((s) => s.site.features.threeD)
  const webgl = useWebGL()
  const reduced = useReducedMotion()
  const [ref, inView] = useInView<HTMLDivElement>('150px')
  const use3d = enabled && webgl !== false

  return (
    <div
      ref={ref}
      className={cx(
        'relative isolate overflow-hidden rounded-[2.5rem] border border-ivory/15 bg-gradient-to-b from-charcoal/80 via-forest/25 to-charcoal/95 shadow-[0_30px_70px_-20px_rgba(0,0,0,0.65)] backdrop-blur-xl ring-1 ring-ivory/10',
        className,
      )}
    >
      {/* Decorative ambient auras behind the 3D scene */}
      <div
        className="pointer-events-none absolute -left-1/4 -top-1/4 h-3/4 w-3/4 rounded-full bg-champagne/15 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-1/4 -right-1/4 h-3/4 w-3/4 rounded-full bg-forest/35 blur-3xl"
        aria-hidden="true"
      />

      {use3d && webgl && inView ? (
        <Suspense fallback={<HeroSkeleton />}>
          <Hero3DCanvas animate={!reduced} />
        </Suspense>
      ) : use3d && webgl === null ? (
        <HeroSkeleton />
      ) : (
        <StaticHeroIllustration />
      )}

      {/* Interactive badge & micro note */}
      <div className="pointer-events-none absolute bottom-4 inset-x-5 flex items-center justify-between text-[11px] text-ivory/80">
        <span className="inline-flex items-center gap-2 rounded-full border border-ivory/15 bg-charcoal/80 px-3 py-1 font-medium shadow-md backdrop-blur-md">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse" />
          {caption ?? 'ILMORA • Yagona oylik ta‘lim ekotizimi'}
        </span>
        <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] text-ivory/55">
          <Icon name="sparkles" className="h-3 w-3 text-champagne" />
          3D Interactive
        </span>
      </div>
    </div>
  )
}

function HeroSkeleton() {
  return (
    <div className="relative flex h-full w-full items-center justify-center bg-charcoal/40 animate-pulse" aria-hidden="true">
      <div className="h-36 w-36 rounded-full border-4 border-champagne/30" />
    </div>
  )
}

function StaticHeroIllustration() {
  return (
    <div className="relative flex h-full w-full items-center justify-center p-6" aria-hidden="true">
      <svg viewBox="0 0 500 400" className="h-full w-full" fill="none">
        <defs>
          <linearGradient id="heroDarkBg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1C2422" />
            <stop offset="100%" stopColor="#121816" />
          </linearGradient>
          <linearGradient id="heroCard1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#F7F5F0" />
          </linearGradient>
          <linearGradient id="heroGold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#E2CCA4" />
            <stop offset="100%" stopColor="#A67C52" />
          </linearGradient>
          <linearGradient id="heroForest" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#163C35" />
            <stop offset="100%" stopColor="#2A5C50" />
          </linearGradient>
          <filter id="heroShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="14" stdDeviation="18" floodColor="#000000" floodOpacity="0.45" />
          </filter>
        </defs>

        <rect width="500" height="400" rx="36" fill="url(#heroDarkBg)" />

        {/* Central orbit ring */}
        <ellipse cx="250" cy="200" rx="160" ry="85" stroke="#C8AD7F" strokeWidth="2" strokeDasharray="6 6" opacity="0.5" />
        <ellipse cx="250" cy="200" rx="120" ry="60" stroke="#2A5C50" strokeWidth="1.5" opacity="0.4" />

        {/* Center core token */}
        <g filter="url(#heroShadow)">
          <ellipse cx="250" cy="200" rx="44" ry="24" fill="url(#heroForest)" />
          <ellipse cx="250" cy="195" rx="38" ry="20" fill="url(#heroGold)" opacity="0.9" />
          <text x="250" y="199" textAnchor="middle" fill="#163C35" fontSize="11" fontWeight="bold" letterSpacing="0.12em">ILMORA</text>
        </g>

        {/* Card 1 - Left Floating Card (Languages) */}
        <g filter="url(#heroShadow)" transform="translate(45, 80) rotate(-6)">
          <rect width="165" height="110" rx="14" fill="url(#heroCard1)" stroke="#C8AD7F" strokeWidth="1" strokeOpacity="0.4" />
          <rect x="14" y="14" width="48" height="12" rx="6" fill="#C8AD7F" />
          <circle cx="146" cy="20" r="4" fill="#163C35" />
          <rect x="14" y="38" width="95" height="10" rx="4" fill="#202725" />
          <rect x="14" y="54" width="65" height="6" rx="3" fill="#202725" opacity="0.45" />
          <rect x="14" y="78" width="75" height="14" rx="5" fill="#E3EBE5" />
          <rect x="100" y="78" width="48" height="14" rx="5" fill="#163C35" />
        </g>

        {/* Card 2 - Right Floating Card (3D Design) */}
        <g filter="url(#heroShadow)" transform="translate(290, 65) rotate(5)">
          <rect width="165" height="110" rx="14" fill="url(#heroCard1)" stroke="#C8AD7F" strokeWidth="1" strokeOpacity="0.4" />
          <rect x="14" y="14" width="55" height="12" rx="6" fill="#163C35" />
          <circle cx="146" cy="20" r="4" fill="#C8AD7F" />
          <rect x="14" y="38" width="85" height="10" rx="4" fill="#202725" />
          <rect x="14" y="54" width="60" height="6" rx="3" fill="#202725" opacity="0.45" />
          <rect x="14" y="78" width="65" height="14" rx="5" fill="#E3EBE5" />
          <rect x="90" y="78" width="58" height="14" rx="5" fill="#C8AD7F" />
        </g>

        {/* Card 3 - Bottom Floating Card (Math & IT) */}
        <g filter="url(#heroShadow)" transform="translate(170, 220) rotate(-2)">
          <rect width="175" height="115" rx="14" fill="url(#heroCard1)" stroke="#C8AD7F" strokeWidth="1" strokeOpacity="0.4" />
          <rect x="14" y="14" width="62" height="12" rx="6" fill="#E3EBE5" />
          <circle cx="156" cy="20" r="4" fill="#163C35" />
          <rect x="14" y="38" width="105" height="10" rx="4" fill="#202725" />
          <rect x="14" y="54" width="75" height="6" rx="3" fill="#202725" opacity="0.45" />
          <rect x="14" y="80" width="85" height="16" rx="6" fill="#E3EBE5" />
          <rect x="110" y="80" width="48" height="16" rx="6" fill="#163C35" />
        </g>
      </svg>
    </div>
  )
}
