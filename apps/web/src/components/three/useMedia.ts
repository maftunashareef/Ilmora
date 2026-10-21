import { useEffect, useRef, useState, type RefObject } from 'react'

let webglCache: boolean | null = null

/** Detect WebGL once; falls back to static illustrations when unavailable. */
export function useWebGL(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(webglCache)
  useEffect(() => {
    // Another consumer may have filled the cache after this hook captured its initial state,
    // so always sync local state from the cache instead of returning early.
    if (webglCache === null) {
      try {
        const c = document.createElement('canvas')
        const gl = c.getContext('webgl2') || c.getContext('webgl')
        webglCache = !!gl
      } catch {
        webglCache = false
      }
    }
    setOk(webglCache)
  }, [])
  return ok
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

/** True while the element is near/inside the viewport — used to pause offscreen rendering and lazy-load media. */
export function useInView<T extends Element>(rootMargin = '200px'): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { rootMargin })
    io.observe(el)
    return () => io.disconnect()
  }, [rootMargin])
  return [ref, inView]
}

export const isCoarsePointer = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
