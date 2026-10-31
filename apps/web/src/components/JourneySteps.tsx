import { MAX_CART_COURSES } from '@ilmora/shared'
import type { TKey } from '../i18n/translations'
import { useT } from '../i18n/useT'
import { cx, Icon, LinkButton, SectionHeading } from './ui'

/** The five steps from choosing courses to the first lesson; the texts are in the dictionary (journey.s1 … journey.s5). */
const STEPS = [
  { icon: 'book' },
  { icon: 'layers' },
  { icon: 'calendar' },
  { icon: 'cart' },
  { icon: 'play' },
] as const

const key = (i: number, part: 'title' | 'body' | 'short') => `journey.s${i + 1}.${part}` as TKey

/**
 * "How ILMORA works" as a section (section type `journey`, for the home and How It Works pages): five connected cards, a
 * line that draws in when the section scrolls into view, and a vertical timeline on phones.
 */
export function JourneySection({ title, subtitle }: { title?: string; subtitle?: string }) {
  const { t } = useT()
  return (
    <section className="relative overflow-hidden bg-paper py-20 lg:py-28">
      <div className="float-a pointer-events-none absolute -right-28 top-12 h-80 w-80 rounded-full border border-champagne/30" aria-hidden="true" />
      <div className="container-x relative">
        <SectionHeading eyebrow={t('journey.eyebrow')} title={title || t('journey.title')} subtitle={subtitle || t('journey.subtitle')} align="center" />
        <div className="relative mt-12">
          {/* The connection between the steps: across the cards on wide screens, down their left edge on phones. */}
          <span className="journey-line reveal pointer-events-none absolute left-[10%] right-[10%] top-[2.25rem] hidden h-px bg-gradient-to-r from-champagne via-forest/40 to-champagne lg:block" aria-hidden="true" />
          <span className="pointer-events-none absolute bottom-6 left-[1.6rem] top-6 w-px bg-gradient-to-b from-champagne via-forest/30 to-champagne lg:hidden" aria-hidden="true" />
          <ol className="reveal-stagger relative grid gap-4 lg:grid-cols-5 lg:gap-5">
            {STEPS.map((s, i) => (
              <li key={i} className="reveal group relative flex gap-4 lg:block">
                <span className="relative z-10 flex h-[3.25rem] w-[3.25rem] shrink-0 items-center justify-center rounded-2xl border border-champagne/60 bg-ivory text-forest shadow-soft transition duration-300 group-hover:-translate-y-0.5 group-hover:bg-forest group-hover:text-ivory lg:mx-auto lg:h-[4.5rem] lg:w-[4.5rem]">
                  <Icon name={s.icon} className="h-5 w-5 lg:h-6 lg:w-6" />
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-champagne text-[10px] font-bold text-forest">{i + 1}</span>
                </span>
                <div className="card min-w-0 flex-1 p-4 transition duration-300 group-hover:-translate-y-1 group-hover:border-forest/30 group-hover:shadow-lift lg:mt-5 lg:p-5 lg:text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-champagne">{t('journey.step', { n: i + 1 })}</div>
                  <h3 className="mt-1 font-display text-xl leading-snug text-charcoal">{t(key(i, 'title'))}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-charcoal/65">{t(key(i, 'body'), { n: MAX_CART_COURSES })}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <LinkButton to="/builder" size="lg">{t('journey.cta')} <Icon name="arrowRight" className="h-4 w-4" /></LinkButton>
          <LinkButton to="/course-finder" size="lg" variant="secondary">{t('finder.title')}</LinkButton>
        </div>
      </div>
    </section>
  )
}

/**
 * The same five steps as a compact tracker beside the course selection in the builder. Steps done so far are ticked, the
 * current one is highlighted and explained in one line, and each reachable step takes the student to its part of the page.
 */
export function JourneyTracker({ done, current, onStep, canReview }: { done: boolean[]; current: number; onStep: (step: number) => void; canReview: boolean }) {
  const { t } = useT()
  return (
    <nav aria-label={t('journey.title')} className="mb-8 rounded-card border border-champagne/40 bg-gradient-to-r from-paper via-ivory to-sage/30 px-3 py-4 sm:px-5">
      <ol className="relative grid grid-cols-5">
        {STEPS.map((s, i) => {
          const isDone = done[i]
          const isCurrent = i === current
          // Step 5 (start learning) happens after payment; step 4 opens the review page once the selection is complete.
          const reachable = i < 3 || (i === 3 && canReview)
          return (
            <li key={i} className="relative flex flex-col items-center text-center">
              {i > 0 && <span className={cx('absolute right-1/2 top-4 h-px w-full -translate-y-1/2 transition-colors duration-500', done[i - 1] ? 'bg-forest/60' : 'bg-charcoal/15')} aria-hidden="true" />}
              <button
                type="button"
                disabled={!reachable}
                onClick={() => onStep(i)}
                aria-current={isCurrent ? 'step' : undefined}
                className="group relative z-10 flex flex-col items-center gap-1.5 rounded-control px-1 disabled:cursor-default"
              >
                <span className={cx(
                  'flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold transition duration-300',
                  isDone ? 'border-forest bg-forest text-ivory' : isCurrent ? 'journey-current relative border-champagne bg-champagne text-forest' : 'border-charcoal/20 bg-paper text-charcoal/55',
                  reachable && !isDone && !isCurrent && 'group-hover:border-forest/50 group-hover:text-forest',
                )}>
                  {isDone ? <Icon name="check" className="h-3.5 w-3.5" /> : <Icon name={s.icon} className="h-3.5 w-3.5" />}
                </span>
                <span className={cx('text-[10px] font-medium leading-tight sm:text-xs', isCurrent ? 'text-forest' : 'text-charcoal/60')}>{t(key(i, 'short'))}</span>
                <span className="sr-only">{t('journey.step', { n: i + 1 })}: {t(key(i, 'title'))}{isDone ? `, ${t('journey.done')}` : ''}</span>
              </button>
            </li>
          )
        })}
      </ol>
      <p className="mt-3 text-center text-xs leading-relaxed text-charcoal/65" aria-live="polite">
        <span className="font-semibold text-forest">{t('journey.step', { n: current + 1 })}: {t(key(current, 'title'))}.</span> {t(key(current, 'body'), { n: MAX_CART_COURSES })}
      </p>
    </nav>
  )
}
