'use client'
import { useEffect } from 'react'
import { Link } from '@/lib/router'
import { applyTheme } from '../lib/theme'
import { useStore } from '../store/useStore'
import { Icon } from './ui'
import { cx } from './ui/helpers'

/** Applies Super Admin theme + language to the document. */
export function ThemeApplier() {
  const theme = useStore((s) => s.site.theme)
  const lang = useStore((s) => s.lang)
  useEffect(() => applyTheme(theme), [theme])
  useEffect(() => { document.documentElement.lang = lang }, [lang])
  return null
}

/**
 * Scroll-reveal manager (progressive enhancement, novator-style).
 * Adds `reveal-on` to <html> so `.reveal` elements start hidden, then flips
 * `is-visible` as they enter the viewport. New nodes (route changes, filters)
 * are picked up through a MutationObserver. Honours prefers-reduced-motion.
 */
export function RevealManager() {
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const html = document.documentElement
    html.classList.add('reveal-on')
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible')
            io.unobserve(e.target)
          }
        }
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.06 },
    )
    const observe = (root: ParentNode) => root.querySelectorAll('.reveal:not(.is-visible)').forEach((el) => io.observe(el))
    observe(document)
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes') {
          const el = m.target as Element
          if (el.classList.contains('reveal') && !el.classList.contains('is-visible')) io.observe(el)
          continue
        }
        m.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return
          if (n.classList.contains('reveal') && !n.classList.contains('is-visible')) io.observe(n)
          observe(n)
        })
      }
    })
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    // Fallback for fast flicks/jumps: anything at or above the fold that the observer never
    // caught intersecting (it skipped straight past) is revealed on the next scroll frame.
    let raf = 0
    const sweep = () => {
      raf = 0
      const limit = window.innerHeight * 0.94
      document.querySelectorAll('.reveal:not(.is-visible)').forEach((el) => {
        if (el.getBoundingClientRect().top < limit) el.classList.add('is-visible')
      })
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(sweep) }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      io.disconnect()
      mo.disconnect()
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(raf)
      html.classList.remove('reveal-on')
    }
  }, [])
  return null
}

/**
 * Tables marked `table-cards` turn into one card per row on phones (CSS in globals.css). Each cell gets its
 * column title from the table head as `data-label`, so the card can show "Title: value" — kept in sync as rows change.
 */
export function TableCardLabels() {
  useEffect(() => {
    const label = (table: HTMLTableElement) => {
      const head = table.tHead?.rows[table.tHead.rows.length - 1]
      if (!head) return
      const titles: string[] = []
      for (const th of Array.from(head.cells)) for (let i = 0; i < th.colSpan; i++) titles.push((th.textContent ?? '').trim())
      for (const body of [...Array.from(table.tBodies), table.tFoot].filter(Boolean) as HTMLTableSectionElement[]) {
        for (const row of Array.from(body.rows)) {
          let col = 0
          for (const cell of Array.from(row.cells)) {
            const title = titles[col] ?? ''
            if (cell.getAttribute('data-label') !== title) cell.setAttribute('data-label', title)
            col += cell.colSpan
          }
        }
      }
    }
    const all = () => document.querySelectorAll<HTMLTableElement>('table.table-cards').forEach(label)
    all()
    let raf = 0
    const mo = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; all() }) })
    mo.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => { mo.disconnect(); cancelAnimationFrame(raf) }
  }, [])
  return null
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  if (!toasts.length) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[90] flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
      {toasts.map((t) =>
        t.link ? (
          // A toast with a next step (e.g. "Go to cart"): the whole pill is the link.
          <Link
            key={t.id}
            to={t.link.to}
            onClick={() => dismiss(t.id)}
            className={cx('pointer-events-auto animate-rise inline-flex max-w-md flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full py-2.5 pl-4 pr-2 text-sm shadow-lift', t.tone === 'warn' ? 'bg-amber-100 text-amber-900' : 'bg-forest text-ivory')}
          >
            <span className="inline-flex min-w-0 items-center gap-2"><Icon name={t.tone === 'warn' ? 'warn' : 'check'} className="h-4 w-4 shrink-0" />{t.text}</span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-champagne px-3 py-1 text-xs font-semibold text-forest">{t.link.label}<Icon name="arrowRight" className="h-3.5 w-3.5" /></span>
          </Link>
        ) : (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            className={cx('pointer-events-auto animate-rise inline-flex max-w-md items-center gap-2 rounded-full px-4 py-2.5 text-sm shadow-lift', t.tone === 'warn' ? 'bg-amber-100 text-amber-900' : 'bg-forest text-ivory')}
          >
            <Icon name={t.tone === 'warn' ? 'warn' : 'check'} className="h-4 w-4" />
            {t.text}
          </button>
        ),
      )}
    </div>
  )
}
