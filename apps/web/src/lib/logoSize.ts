/**
 * Display size for a logo so that different shapes look equally large: a square (or tall) emblem gets the full height, a
 * wide word mark less height and more width (height ∝ aspect^-0.45), never wider than `maxWidth`. The proportions are the
 * logo's own; only the scale changes.
 */
export function balancedLogoSize(aspect: number, height: number, maxWidth: number): { width: number; height: number } {
  if (!Number.isFinite(aspect) || aspect <= 0) return { width: height, height }
  let h = aspect > 1 ? height * Math.pow(aspect, -0.45) : height
  let w = h * aspect
  if (w > maxWidth) {
    w = maxWidth
    h = w / aspect
  }
  return { width: Math.round(w), height: Math.round(h) }
}
