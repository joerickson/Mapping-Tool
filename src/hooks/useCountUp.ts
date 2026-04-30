// useCountUp — animate a numeric display from its previous value to the
// next over ~300ms.
//
// Why: numbers that change (synthesis hero, stat cards, risk score) feel
// more alive when they tween instead of snapping. Per design rules the
// effect is subtle — 300ms ease-out, no overshoot, no bounce.
//
// Honors prefers-reduced-motion: when reduced motion is on, returns the
// final value immediately.
//
// Re-fires whenever the input value changes, including 0 → N on first
// mount. Pass animateOnMount: false to suppress the initial tween when
// the value is loaded synchronously (e.g. from cache).
import { useEffect, useRef, useState } from 'react'

const DEFAULT_DURATION_MS = 300

export interface CountUpOptions {
  durationMs?: number
  /** When false, the first render returns the target value without animating. */
  animateOnMount?: boolean
}

export function useCountUp(
  target: number | null | undefined,
  options: CountUpOptions = {}
): number {
  const { durationMs = DEFAULT_DURATION_MS, animateOnMount = true } = options
  const [display, setDisplay] = useState<number>(target ?? 0)
  const previousRef = useRef<number>(animateOnMount ? 0 : (target ?? 0))
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (target == null || !Number.isFinite(target)) {
      setDisplay(0)
      previousRef.current = 0
      return
    }

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced || durationMs <= 0) {
      setDisplay(target)
      previousRef.current = target
      return
    }

    const start = previousRef.current
    const delta = target - start
    if (delta === 0) {
      setDisplay(target)
      return
    }

    const startTs = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - startTs) / durationMs, 1)
      // ease-out cubic: matches the "150-200ms ease-out for hovers" voice.
      const eased = 1 - Math.pow(1 - t, 3)
      const next = start + delta * eased
      setDisplay(next)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        setDisplay(target)
        previousRef.current = target
      }
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [target, durationMs])

  return display
}
