import type { Theme } from '../types'

const RADIUS: Record<Theme['radius'], { card: string; control: string }> = {
  sharp: { card: '0.375rem', control: '0.25rem' },
  soft: { card: '1.25rem', control: '0.75rem' },
  round: { card: '2rem', control: '999px' },
}

const FONT_STACK: Record<string, string> = {
  'Cormorant Garamond': '"Cormorant Garamond", "Playfair Display", Georgia, serif',
  'Playfair Display': '"Playfair Display", "Cormorant Garamond", Georgia, serif',
  Inter: '"Inter", "Manrope", system-ui, sans-serif',
  Manrope: '"Manrope", "Inter", system-ui, sans-serif',
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
  root.style.setProperty('--f-display', FONT_STACK[theme.fonts.display] ?? FONT_STACK['Cormorant Garamond'])
  root.style.setProperty('--f-body', FONT_STACK[theme.fonts.body] ?? FONT_STACK.Inter)
  const r = RADIUS[theme.radius] ?? RADIUS.soft
  root.style.setProperty('--r-card', r.card)
  root.style.setProperty('--r-control', r.control)
}
