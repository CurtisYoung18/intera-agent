'use client'
import { useEffect, useRef, useCallback, useState, useLayoutEffect } from 'react'

interface Props {
  collapsed?: boolean
  size?: number
}

const LETTERS = ['n', 't', 'e', 'r', 'a'] as const
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

// ── Measure character widths (memoised per font-size) ──
const widthCache = new Map<number, Record<string, number>>()

function measureWidth(size: number, ch: string): number {
  let cache = widthCache.get(size)
  if (!cache) { cache = {}; widthCache.set(size, cache) }
  if (cache[ch] !== undefined) return cache[ch]
  const s = document.createElement('span')
  s.style.cssText = `font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:500;font-size:${size}px;position:fixed;visibility:hidden;top:0;left:0;white-space:nowrap`
  s.textContent = ch
  document.body.appendChild(s)
  const w = s.getBoundingClientRect().width
  document.body.removeChild(s)
  cache[ch] = w
  return w
}

function getWidths(size: number): Record<string, number> {
  const r: Record<string, number> = {}
  for (const ch of LETTERS) r[ch] = measureWidth(size, ch)
  return r
}

// ── Core animation primitive (exactly matching logo-animation.html animL) ──
function animLetter(
  el: HTMLSpanElement,
  opts: { mw?: number; op?: number; tx?: number; d?: string; delay?: number },
) {
  const { mw, op, tx = 0, d = '500ms', delay = 0 } = opts
  el.style.transition = [
    mw !== undefined ? `max-width ${d} ${EASE} ${delay}ms` : '',
    `opacity 320ms ease ${delay}ms`,
    `transform ${d} ${EASE} ${delay}ms`,
  ].filter(Boolean).join(', ')
  requestAnimationFrame(() => {
    if (mw !== undefined) el.style.maxWidth = mw + 'px'
    if (op !== undefined) el.style.opacity = String(op)
    el.style.transform = `translateX(${tx}px)`
  })
}

// ── Component ──
export default function InteraLogo({ collapsed = false, size = 22 }: Props) {
  const letterRefs = useRef<(HTMLSpanElement | null)[]>([])
  // tick: forces React to create fresh DOM nodes → refs point to live elements
  const [tick, setTick] = useState(0)
  const prevCollapsed = useRef(collapsed)

  const animate = useCallback(
    (open: boolean, instant = false) => {
      const widths = getWidths(size)
      const d = instant ? '0ms' : '500ms'
      const refs = letterRefs.current
      LETTERS.forEach((ch, i) => {
        const el = refs[i]
        if (!el) return
        const w = widths[ch]
        if (open) {
          animLetter(el, { mw: w, op: 1, tx: 0, d, delay: i * 30 })
        } else {
          animLetter(el, { mw: 0, op: 0, tx: -3, d, delay: (LETTERS.length - 1 - i) * 20 })
        }
      })
    },
    [size],
  )

  // Animate on mount (stagger reveal) and on collapsed changes
  useEffect(() => {
    const justMounted = prevCollapsed.current === collapsed
    prevCollapsed.current = collapsed

    if (justMounted) {
      // Initial mount: reveal after delay if not collapsed
      if (!collapsed) {
        const id = setTimeout(() => animate(true), 400)
        return () => clearTimeout(id)
      }
    } else {
      // collapsed prop changed: animate immediately
      animate(!collapsed)
      setTick((t) => t + 1)
    }
  }, [collapsed, animate])

  // Click to replay
  const handleClick = useCallback(() => {
    animate(false)
    setTick((t) => t + 1)
    setTimeout(() => animate(true), 520)
  }, [animate])

  const widths = getWidths(size)

  return (
    <span
      className="intera-logo"
      style={{ fontSize: size, cursor: 'default', fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontWeight: 500, letterSpacing: '-0.02em', display: 'inline-flex', alignItems: 'baseline', lineHeight: 1, userSelect: 'none' }}
      aria-label="Intera"
      onClick={handleClick}
      title="Intera"
    >
      <span style={{ display: 'inline-block' }}>I</span>
      {LETTERS.map((ch, i) => (
        <span
          key={`${ch}-${tick}-${size}`}
          ref={(el) => { letterRefs.current[i] = el }}
          style={{
            display: 'inline-block',
            maxWidth: 0,
            opacity: 0,
            transform: 'translateX(-3px)',
            whiteSpace: 'pre',
            overflow: 'hidden',
          }}
        >
          {ch}
        </span>
      ))}
    </span>
  )
}
