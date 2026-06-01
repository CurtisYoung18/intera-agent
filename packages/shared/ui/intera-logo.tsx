'use client'
import { useEffect, useRef, useCallback, useState } from 'react'

interface Props {
  collapsed?: boolean
  size?: number
}

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
const CYCLE_MS = 5000

// ── Measure ──
const widthCache = new Map<number, Record<string, number>>()

function measure(c: string, px: number): number {
  let cache = widthCache.get(px)
  if (!cache) { cache = {}; widthCache.set(px, cache) }
  if (cache[c] !== undefined) return cache[c]
  const s = document.createElement('span')
  s.style.cssText = `font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:500;font-size:${px}px;position:fixed;visibility:hidden;top:0;left:0`
  s.textContent = c
  document.body.appendChild(s)
  const w = s.getBoundingClientRect().width
  document.body.removeChild(s)
  cache[c] = w
  return w
}

// ── animL ──
function animL(
  el: HTMLElement | null,
  opts: { mw?: number; op?: number; tx?: number; d?: string; delay?: number },
) {
  if (!el) return
  const { mw, op, tx = 0, d = '500ms', delay = 0 } = opts
  el.style.transition = [
    mw !== undefined ? `max-width ${d} ${EASE} ${delay}ms` : '',
    `opacity 330ms ease ${delay}ms`,
    `transform ${d} ${EASE} ${delay}ms`,
  ].filter(Boolean).join(', ')
  requestAnimationFrame(() => {
    if (mw !== undefined) el.style.maxWidth = mw + 'px'
    if (op !== undefined) el.style.opacity = String(op)
    el.style.transform = `translateX(${tx}px)`
  })
}

// ── Component ──
export default function InteraLogo({ collapsed = false, size = 26 }: Props) {
  const letterRefs = useRef<(HTMLSpanElement | null)[]>([])
  const iRef = useRef<HTMLSpanElement | null>(null)
  const [phase, setPhase] = useState(0)
  const [tick, setTick] = useState(0)
  const phaseRef = useRef(0)
  const mounted = useRef(false)
  const prevCollapsed = useRef(collapsed)

  const applyPhase = useCallback(
    (p: number) => {
      const W = { I: measure('I', size), A: measure('A', size), N: measure('N', size), T: measure('T', size), E: measure('E', size), R: measure('R', size), A2: measure('A', size) }
      const [a, n, t, e, r, aLast] = letterRefs.current

      if (p === 0) {
        animL(iRef.current, { op: 1, tx: 0 })
        animL(a, { mw: 0, op: 0, tx: 0 })
        animL(n, { mw: W.N, op: 1, tx: 0, delay: 0 })
        animL(t, { mw: W.T, op: 1, tx: 0, delay: 30 })
        animL(e, { mw: W.E, op: 1, tx: 0, delay: 55 })
        animL(r, { mw: W.R, op: 1, tx: 0, delay: 80 })
        animL(aLast, { mw: W.A2, op: 1, tx: 0, delay: 105 })
      } else if (p === 1) {
        animL(iRef.current, { op: 1, tx: 0, delay: 80 })
        animL(a, { mw: W.A + 2, op: 1, tx: 0, delay: 110 })
        animL(n, { mw: 0, op: 0, tx: 0, delay: 0 })
        animL(t, { mw: 0, op: 0, tx: 0, delay: 20 })
        animL(e, { mw: 0, op: 0, tx: 0, delay: 38 })
        animL(r, { mw: 0, op: 0, tx: 0, delay: 55 })
        animL(aLast, { mw: 0, op: 0, tx: 0, delay: 70 })
      } else {
        animL(iRef.current, { op: 1, tx: W.A + 2, delay: 50 })
        animL(a, { mw: W.A + 2, op: 1, tx: -(W.I + 2), delay: 50 })
        animL(n, { mw: 0, op: 0, tx: 0 })
        animL(t, { mw: 0, op: 0, tx: 0 })
        animL(e, { mw: 0, op: 0, tx: 0 })
        animL(r, { mw: 0, op: 0, tx: 0 })
        animL(aLast, { mw: 0, op: 0, tx: 0 })
      }
    },
    [size],
  )

  // Apply phase after tick remounts DOM
  useEffect(() => {
    if (!mounted.current) return
    applyPhase(phase)
  }, [tick]) // eslint-disable-line

  // Mount
  useEffect(() => {
    mounted.current = true
    if (!collapsed) {
      const id = setTimeout(() => { setTick((t) => t + 1) }, 400)
      return () => clearTimeout(id)
    }
  }, []) // eslint-disable-line

  // Auto-cycle
  useEffect(() => {
    if (collapsed || !mounted.current) return
    const interval = setInterval(() => {
      const next = ((phaseRef.current + 1) % 3) as 0 | 1 | 2
      phaseRef.current = next
      setPhase(next)
      setTick((t) => t + 1)
    }, CYCLE_MS)
    return () => clearInterval(interval)
  }, [collapsed])

  // Collapsed toggle
  useEffect(() => {
    if (!mounted.current) return
    if (prevCollapsed.current === collapsed) return
    prevCollapsed.current = collapsed
    if (!collapsed) {
      phaseRef.current = 0
      setPhase(0)
      setTimeout(() => setTick((t) => t + 1), 150)
    } else {
      phaseRef.current = 0
      setPhase(0)
    }
    setTick((t) => t + 1)
  }, [collapsed])

  // Click
  const handleClick = useCallback(() => {
    if (collapsed) return
    const next = ((phase + 1) % 3) as 0 | 1 | 2
    phaseRef.current = next
    setPhase(next)
    setTick((t) => t + 1)
  }, [phase, collapsed])

  return (
    <span
      className="intera-logo"
      style={{ fontSize: size, cursor: collapsed ? 'default' : 'pointer', fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontWeight: 500, letterSpacing: '-0.02em', display: 'inline-flex', alignItems: 'baseline', lineHeight: 1, userSelect: 'none' }}
      aria-label="Intera"
      onClick={handleClick}
      title="Intera"
    >
      <span ref={iRef} style={{ display: 'inline-block', flexShrink: 0 }}>I</span>
      {['A', 'N', 'T', 'E', 'R', 'A'].map((ch, i) => (
        <span
          key={`${ch}-${i}-${tick}-${size}`}
          ref={(el) => { letterRefs.current[i] = el }}
          style={{ display: 'inline-block', maxWidth: 0, opacity: 0, whiteSpace: 'pre', overflow: 'hidden', flexShrink: 0 }}
        >
          {ch}
        </span>
      ))}
    </span>
  )
}
