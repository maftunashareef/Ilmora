import type { Theme } from '../types'

const RADIUS: Record<Theme['radius'], { card: string; control: string }> = {
  sharp: { card: '0.375rem', control: '0.25rem' },
  soft: { card: '1.25rem', control: '0.75rem' },
  round: { card: '2rem', control: '999px' },
}

const FONT_STACK: Record<string, string> = {
  Prata: 'var(--font-prata), "Prata", Georgia, serif',
  'Cormorant Garamond': 'var(--font-cormorant), "Cormorant Garamond", Georgia, serif',
  'Playfair Display': 'var(--font-playfair), "Playfair Display", Georgia, serif',
  Inter: 'var(--font-inter), "Inter", system-ui, sans-serif',
  Manrope: 'var(--font-manrope), "Manrope", system-ui, sans-serif',
}

/** Push Super Admin theme settings into CSS variables consumed by Tailwind tokens. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement
  const c = theme.colors
  root.style.setProperty('--c-ivory', c.ivory)
  root.style.setProperty('--c-forest', c.forest)
  root.style.setProperty('--c-charcoal', c.charcoal)
  root.style.setProperty('--c-champagne', c.champagne)
  root.style.setProperty('--c-sage', c.sage)
  root.style.setProperty('--c-white', c.white)
  root.style.setProperty('--f-display', FONT_STACK[theme.fonts.display] ?? FONT_STACK.Prata)
  root.style.setProperty('--f-body', FONT_STACK[theme.fonts.body] ?? FONT_STACK.Manrope)
  const r = RADIUS[theme.radius] ?? RADIUS.soft
  root.style.setProperty('--r-card', r.card)
  root.style.setProperty('--r-control', r.control)
}
