import { lazy, Suspense, type MutableRefObject } from 'react'
import { useT } from '../../i18n/useT'
import { useStore } from '../../store/useStore'
import { cx, Icon } from '../ui'
import { useInView, useReducedMotion, useWebGL } from './useMedia'

const MiniStudio = lazy(() => import('./MiniStudio'))
const FurnitureAssembly = lazy(() => import('./FurnitureAssembly'))

/**
 * Lazy, lightweight 3D scene with honest fallbacks:
 * - Loaded only when near the viewport; rendering pauses offscreen (frameloop demand).
 * - Reduced motion → static pose. No WebGL or 3D disabled by admin → static SVG illustration.
 */
export function Scene3D({ kind, className, caption, progressRef }: { kind: 'studio' | 'assembly'; className?: string; caption?: string; progressRef?: MutableRefObject<number> }) {
  const { t } = useT()
  const enabled = useStore((s) => s.site.features.threeD)
  const webgl = useWebGL()
  const reduced = useReducedMotion()
  const [ref, inView] = useInView<HTMLDivElement>('150px')
  const use3d = enabled && webgl !== false

  return (
    <div ref={ref} className={cx('relative overflow-hidden rounded-card border border-charcoal/10 bg-gradient-to-b from-sage/70 to-ivory', className)}>
      {use3d && webgl && inView ? (
        <Suspense fallback={<Skeleton />}>
          {kind === 'studio' ? <MiniStudio animate={!reduced} /> : <FurnitureAssembly animate={!reduced && !progressRef} progressRef={progressRef} />}
        </Suspense>
      ) : use3d && webgl === null ? (
        <Skeleton />
      ) : (
        <StaticIllustration kind={kind} />
      )}
      {(caption || !use3d) && (
        <div className="pointer-events-none absolute inset-x-4 bottom-3 flex items-center justify-between gap-2 text-[11px] text-charcoal/55">
          <span>{caption}</span>
          {!use3d && <span className="inline-flex items-center gap-1"><Icon name="info" className="h-3 w-3" />{enabled ? t('home.webglFallback') : t('common.disabled')}</span>}
        </div>
      )}
    </div>
  )
}

function Skeleton() {
  return <div className="h-full w-full animate-pulse bg-sage/40" aria-hidden="true" />
}

function StaticIllustration({ kind }: { kind: 'studio' | 'assembly' }) {
  return (
    <svg viewBox="0 0 400 300" className="h-full w-full" aria-hidden="true">
      <defs>
        <linearGradient id="fl" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#E3EBE5" /><stop offset="1" stopColor="#F7F5F0" /></linearGradient>
      </defs>
      <rect width="400" height="300" fill="url(#fl)" />
      <ellipse cx="200" cy="245" rx="150" ry="14" fill="#163C35" opacity="0.08" />
      {kind === 'studio' ? (
        <g stroke="#163C35" strokeWidth="1.6" fill="none" strokeLinecap="round">
          <rect x="90" y="150" width="220" height="10" rx="2" fill="#A67C52" stroke="none" />
          <path d="M100 160v70M300 160v70M110 160v70M290 160v70" />
          <rect x="220" y="128" width="46" height="22" rx="2" fill="#163C35" stroke="none" />
          <rect x="222" y="120" width="46" height="8" rx="2" fill="#C8AD7F" stroke="none" />
          <path d="M120 150v-58M120 92l30 12" />
          <path d="M150 104l-18 8 8 4z" fill="#163C35" />
          <rect x="150" y="60" width="110" height="60" rx="4" fill="#FFFFFF" />
          <path d="M162 76h44M162 88h70M162 100h56" stroke="#C8AD7F" strokeWidth="3" />
        </g>
      ) : (
        <g stroke="#6B4F3A" strokeWidth="6" fill="none" strokeLinecap="round">
          <path d="M140 240v-80M260 240v-80M150 240v-80M250 240v-80" />
          <rect x="130" y="150" width="140" height="12" rx="2" fill="#A67C52" stroke="none" />
          <path d="M140 150V60M170 150V60" />
          <rect x="132" y="60" width="46" height="30" rx="3" fill="#A67C52" stroke="none" />
          <path d="M140 200h30" stroke="#C8AD7F" />
        </g>
      )}
    </svg>
  )
}
