'use client'
import { useEffect, useRef, useCallback } from 'react'
import { makeDisc, serifISvg, serifASvg, discBackground, discBorder, discShadow } from './intera-svg'

interface InteraLogoProps {
  size?: number
  collapsed?: boolean
  mode?: 'idle' | 'none'
  theme?: 'light' | 'dark'
}

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
const CYCLE_PAUSE = 5000 // pause between cycles

// Scaling helpers — all derived from the base `size` prop
function fontSize(size: number) { return Math.round(size * 0.76) }
function wordMargin(size: number) { return Math.round(size * 0.07) }
function aiGap(size: number) { return Math.round(-size * 0.64) }
function baselineBottom(size: number) { return Math.round(-size * 0.167) }

export default function InteraLogo({
  size = 26,
  collapsed = false,
  mode = 'none',
  theme = 'light',
}: InteraLogoProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const lockupRef = useRef<HTMLDivElement>(null)
  const animsRef = useRef<Animation[]>([])
  const timersRef = useRef<number[]>([])
  const cycleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isAIStateRef = useRef(false)
  const discOrigRef = useRef<{ bg: string; border: string; shadow: string } | null>(null)

  const textColor = theme === 'dark' ? '#ffffff' : '#1a1814'
  const strokeColor = theme === 'dark' ? '#ffffff' : '#1a1814'

  const clearAll = useCallback(() => {
    animsRef.current.forEach(a => { try { a.cancel() } catch {} })
    animsRef.current = []
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    if (cycleRef.current) { clearTimeout(cycleRef.current); cycleRef.current = null }
  }, [])

  const A = useCallback((el: Element, kf: Keyframe[], opt?: KeyframeAnimationOptions) => {
    const a = el.animate(kf, { fill: 'backwards', easing: EASE, ...opt })
    animsRef.current.push(a)
    return a
  }, [])

  const T = useCallback((fn: () => void, ms: number) => {
    const t = window.setTimeout(fn, ms)
    timersRef.current.push(t)
    return t
  }, [])

  const cancelEl = useCallback((el: Element) => {
    el.getAnimations().forEach(a => { try { a.cancel() } catch {} })
  }, [])

  // ── playIdle: build full lockup + intro animation ──
  const playIdle = useCallback(() => {
    const lockup = lockupRef.current
    if (!lockup) return
    clearAll()
    isAIStateRef.current = false

    while (lockup.firstChild) lockup.removeChild(lockup.firstChild)
    lockup.style.position = 'relative'

    const fs = fontSize(size)
    const wm = wordMargin(size)
    const bb = baselineBottom(size)

    // ── I disc ──
    const { disc, shimmer } = makeDisc(size, theme)
    disc.style.flexShrink = '0'
    disc.style.transition = 'border-color 0.45s ease-out, box-shadow 0.45s ease-out, background 0.45s ease-out'
    disc.appendChild(serifISvg(size, strokeColor))
    discOrigRef.current = { bg: disc.style.background, border: disc.style.borderColor, shadow: disc.style.boxShadow }
    lockup.appendChild(disc)

    // ── Wordmark ──
    const wordWrap = document.createElement('div')
    wordWrap.setAttribute('data-word', '')
    wordWrap.style.cssText = `display:inline-flex;align-items:center;margin-left:${wm}px;overflow:visible;`
    const letters = ['n', 't', 'e', 'r', 'a']
    const spans = letters.map(ch => {
      const s = document.createElement('span')
      s.textContent = ch
      s.style.cssText = `font-family:var(--font-serif);font-style:italic;font-weight:500;font-size:${fs}px;color:${textColor};display:inline-block;white-space:pre;`
      wordWrap.appendChild(s)
      return s
    })
    lockup.appendChild(wordWrap)

    const [sN, sT, sE, sR, sA] = spans

    // ── nterWrap (collapsible middle letters) ──
    const nterWrap = document.createElement('span')
    nterWrap.setAttribute('data-nter', '')
    nterWrap.style.cssText = 'display:inline-flex;overflow:hidden;'
    ;[sN, sT, sE, sR].forEach(s => nterWrap.appendChild(s))
    wordWrap.insertBefore(nterWrap, sA)

    // ── A disc (hidden, overlaid on "a") ──
    const { disc: aDisc, shimmer: aShimmer } = makeDisc(size, theme)
    aDisc.style.position = 'absolute'
    aDisc.style.top = '50%'
    aDisc.style.left = '50%'
    aDisc.style.transform = 'translate(-50%, -50%) scale(0)'
    aDisc.style.opacity = '0'
    aDisc.style.pointerEvents = 'none'
    aDisc.style.zIndex = '2'
    aDisc.style.flexShrink = '0'
    aDisc.style.transition = 'border-color 0.45s ease-out, box-shadow 0.45s ease-out, background 0.45s ease-out'
    aDisc.appendChild(serifASvg(size, strokeColor))

    // ── aWrap (relative container for "a" + A disc) ──
    const aWrap = document.createElement('span')
    aWrap.setAttribute('data-awrap', '')
    aWrap.style.cssText = `position:relative;display:inline-flex;align-items:center;justify-content:center;height:${size}px;`
    aWrap.style.minWidth = '0px'
    aWrap.style.transition = 'none'
    wordWrap.replaceChild(aWrap, sA)
    aWrap.appendChild(sA)
    aWrap.appendChild(aDisc)

    // ── aiPill (unified capsule behind discs, hidden initially) ──
    const aiPill = document.createElement('div')
    aiPill.setAttribute('data-pill', '')
    aiPill.style.cssText = [
      `position:absolute;height:${size}px;border-radius:${size / 2}px;opacity:0;pointer-events:none;z-index:-1;`,
      `background:${discBackground(theme)};`,
      `border:1px solid ${discBorder(theme)};`,
      `box-shadow:${discShadow(theme)};`,
    ].join('')
    lockup.appendChild(aiPill)

    // ── Gradient baseline ──
    const baseline = document.createElement('div')
    baseline.style.cssText = [
      `position:absolute;left:0;right:0;bottom:${bb}px;height:2.5px;border-radius:2px;`,
      `background:linear-gradient(90deg,var(--indigo),var(--lavender));`,
      `transform-origin:left center;`,
    ].join('')
    lockup.appendChild(baseline)

    // ══ INTRO ANIMATION ══
    // Disc scale-in
    A(disc, [
      { opacity: 0, transform: 'scale(0.88)' },
      { opacity: 1, transform: 'scale(1)' },
    ], { duration: 460 })

    // Shimmer
    A(shimmer, [
      { backgroundPosition: '-150% 0' },
      { backgroundPosition: '250% 0' },
    ], { duration: 1100, delay: 500, easing: 'ease-in-out' })

    // I stroke draw
    const drawI = (sel: string, len: number, delay: number, dur: number) => {
      const el = disc.querySelector(sel) as SVGLineElement | null
      if (!el) return
      el.style.strokeDasharray = String(len)
      A(el, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: dur, delay })
    }
    drawI('.i-stem', 24, 220, 500)
    drawI('.i-top', 18, 560, 320)
    drawI('.i-bot', 18, 700, 320)
    drawI('.i-base', 34, 760, 420)

    // Letter reveal (staggered)
    spans.forEach((s, i) => {
      A(s, [
        { opacity: 0, transform: 'translateX(-8px)' },
        { opacity: 1, transform: 'translateX(0)' },
      ], { duration: 420, delay: 880 + i * 110 })
    })

    // Baseline draw
    A(baseline, [
      { transform: 'scaleX(0)' },
      { transform: 'scaleX(1)' },
    ], { duration: 700, delay: 1400 })

    // Store cycle-start timer
    cycleRef.current = setTimeout(cycle, 3600)
  }, [size, theme, textColor, strokeColor, clearAll, A, T, cancelEl])

  // ══ toAI: Intera → AI transition ══
  const toAI = useCallback(() => {
    const lockup = lockupRef.current
    if (!lockup || isAIStateRef.current) return
    isAIStateRef.current = true

    const wordWrap = lockup.querySelector('[data-word]') as HTMLElement | null
    if (!wordWrap) return

    const spans = Array.from(wordWrap.querySelectorAll('span')) as HTMLElement[]
    // spans from wordWrap include nterWrap children + aWrap's span.a
    // Find them properly
    const nterWrap = wordWrap.querySelector('[data-nter]') as HTMLElement | null
    const aWrap = wordWrap.querySelector('[data-awrap]') as HTMLElement | null
    if (!nterWrap || !aWrap) return

    const nterLetters = Array.from(nterWrap.children) as HTMLElement[]
    const sA = aWrap.querySelector('span') as HTMLElement | null
    const aDisc = aWrap.querySelector('.intera-disc') as HTMLElement | null
    const disc = lockup.querySelector('.intera-disc') as HTMLElement | null
    const aiPill = lockup.querySelector('[data-pill]') as HTMLElement | null
    if (!sA || !aDisc || !disc || !aiPill || nterLetters.length < 4) return

    // Store measurements for slide math
    const discW = disc.offsetWidth
    const aW = size
    const nterW = nterWrap.offsetWidth
    const wm = wordMargin(size)
    const wordWrapW = wordWrap.offsetWidth
    const aLeft0 = discW + wm + nterW
    const lockupW = discW + wm + wordWrapW
    const GAP = aiGap(size)
    const groupW = aW + GAP + discW
    const gLeft = lockupW / 2 - groupW / 2
    const aShiftFinal = gLeft - aLeft0
    const discShiftFinal = gLeft + aW + GAP
    const aWrapNaturalW = aWrap.offsetWidth

    // Phase 1: text "a" fades → A disc appears
    cancelEl(sA)
    sA.textContent = 'a'
    sA.style.fontWeight = '500'
    A(sA, [
      { opacity: 1, filter: 'blur(0px)' },
      { opacity: 0, filter: 'blur(2px)' },
    ], { duration: 500, delay: 0, fill: 'forwards', easing: 'ease-in' })

    A(aDisc, [
      { opacity: 0, transform: 'translate(-50%, -50%) scale(0)', offset: 0 },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1.08)', offset: 0.55, easing: EASE },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.75, easing: EASE },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 1 },
    ], { duration: 900, delay: 250, fill: 'forwards' })

    A(aWrap, [
      { minWidth: aWrapNaturalW + 'px', offset: 0 },
      { minWidth: aW + 'px', offset: 0.55, easing: EASE },
      { minWidth: aW + 'px', offset: 1 },
    ], { duration: 900, delay: 250, fill: 'forwards' })

    // A stroke draw
    const drawA = (sel: string, len: number, delay: number, dur: number) => {
      const el = aDisc.querySelector(sel) as SVGLineElement | null
      if (!el) return
      el.style.strokeDasharray = String(len)
      animsRef.current.push(el.animate(
        [{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
        { duration: dur, delay, fill: 'backwards', easing: EASE },
      ))
    }
    drawA('.a-l', 35, 480, 400)
    drawA('.a-l-serif', 15, 680, 200)
    drawA('.a-r', 35, 620, 400)
    drawA('.a-r-serif', 15, 820, 200)
    drawA('.a-bar', 21, 850, 280)
    drawA('.a-apex', 13, 950, 200)
    drawA('.a-base', 50, 1000, 380)

    // Phase 3: nter fades + discs slide + merge
    T(() => {
      // nter collapse (outside-in: r→e→t→n)
      ;[...nterLetters].reverse().forEach((s, i) => {
        cancelEl(s)
        A(s, [
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(0.65)' },
        ], { duration: 450, delay: i * 120, fill: 'forwards', easing: 'ease-in' })
      })

      T(() => {
        const slideDur = 2100

        // I disc slides right
        cancelEl(disc)
        A(disc, [
          { transform: 'translateX(0) scale(1)', offset: 0 },
          { transform: `translateX(${discShiftFinal}px) scale(1)`, offset: 1 },
        ], { duration: slideDur * 0.65, fill: 'forwards', easing: EASE })

        // aWrap slides left
        cancelEl(aWrap)
        A(aWrap, [
          { transform: 'translateX(0)', offset: 0 },
          { transform: `translateX(${aShiftFinal}px)`, offset: 1 },
        ], { duration: slideDur * 0.65, fill: 'forwards', easing: EASE })

        // Dissolve disc borders, reveal aiPill
        T(() => {
          const lockupRect = lockup.getBoundingClientRect()
          const aDiscRect = aDisc.getBoundingClientRect()
          const discRect = disc.getBoundingClientRect()
          const pillLeft = aDiscRect.left - lockupRect.left
          const pillRight = discRect.right - lockupRect.left

          aiPill.style.left = pillLeft + 'px'
          aiPill.style.top = (discRect.top - lockupRect.top) + 'px'
          aiPill.style.width = (pillRight - pillLeft) + 'px'

          disc.style.borderColor = 'transparent'
          disc.style.boxShadow = 'none'
          disc.style.background = 'transparent'
          const dShimmer = disc.querySelector('.intera-disc-shimmer') as HTMLElement | null
          if (dShimmer) dShimmer.style.opacity = '0'

          aDisc.style.borderColor = 'transparent'
          aDisc.style.boxShadow = 'none'
          aDisc.style.background = 'transparent'

          // SVGs render above aiPill
          ;[disc.querySelector('svg'), aDisc.querySelector('svg')].forEach(s => {
            if (s) { s.style.position = 'relative'; s.style.zIndex = '2' }
          })

          A(aiPill, [
            { opacity: 0 },
            { opacity: 1 },
          ], { duration: 500, fill: 'forwards', easing: 'ease-out' })
        }, slideDur * 0.38)
      }, 300)
    }, 900)
  }, [size, theme, clearAll, A, T, cancelEl])

  // ══ toIntera: AI → Intera return ══
  const toIntera = useCallback(() => {
    const lockup = lockupRef.current
    if (!lockup || !isAIStateRef.current) return
    isAIStateRef.current = false

    const wordWrap = lockup.querySelector('[data-word]') as HTMLElement | null
    if (!wordWrap) return

    const nterWrap = wordWrap.querySelector('[data-nter]') as HTMLElement | null
    const aWrap = wordWrap.querySelector('[data-awrap]') as HTMLElement | null
    if (!nterWrap || !aWrap) return

    const nterLetters = Array.from(nterWrap.children) as HTMLElement[]
    const sA = aWrap.querySelector('span') as HTMLElement | null
    const aDisc = aWrap.querySelector('.intera-disc') as HTMLElement | null
    const disc = lockup.querySelector('.intera-disc') as HTMLElement | null
    const aiPill = lockup.querySelector('[data-pill]') as HTMLElement | null
    if (!sA || !aDisc || !disc || !aiPill || nterLetters.length < 4) return

    const orig = discOrigRef.current
    if (!orig) return

    // Recompute reverse positions
    const discW = disc.offsetWidth
    const aW = size
    const nterW = nterWrap.offsetWidth
    const wm = wordMargin(size)
    const wordWrapW = wordWrap.offsetWidth
    const aLeft0 = discW + wm + nterW
    const lockupW = discW + wm + wordWrapW
    const GAP = aiGap(size)
    const groupW = aW + GAP + discW
    const gLeft = lockupW / 2 - groupW / 2
    const aShiftFinal = gLeft - aLeft0
    const discShiftFinal = gLeft + aW + GAP
    const aWrapNaturalW = aWrap.offsetWidth

    // aiPill dissolves
    A(aiPill, [
      { opacity: 1 },
      { opacity: 0 },
    ], { duration: 400, fill: 'forwards', easing: 'ease-in' })

    // Restore disc backgrounds
    T(() => {
      disc.style.background = orig.bg
      disc.style.borderColor = orig.border
      disc.style.boxShadow = orig.shadow
      const dShimmer = disc.querySelector('.intera-disc-shimmer') as HTMLElement | null
      if (dShimmer) dShimmer.style.opacity = '1'
      aDisc.style.background = orig.bg
      aDisc.style.borderColor = orig.border
      aDisc.style.boxShadow = orig.shadow
    }, 120)

    // nter letters fade back (inside-out: n→t→e→r)
    nterLetters.forEach((s, i) => {
      cancelEl(s)
      A(s, [
        { opacity: 0, transform: 'scale(0.65)' },
        { opacity: 1, transform: 'scale(1)' },
      ], { duration: 500, delay: 250 + i * 120, fill: 'forwards', easing: 'ease-out' })
    })

    // Discs slide apart
    cancelEl(disc)
    A(disc, [
      { transform: `translateX(${discShiftFinal}px) scale(1)` },
      { transform: 'translateX(0) scale(1)' },
    ], { duration: 1400, fill: 'forwards', easing: EASE })

    cancelEl(aWrap)
    A(aWrap, [
      { transform: `translateX(${aShiftFinal}px)`, minWidth: aW + 'px' },
      { transform: 'translateX(0)', minWidth: aWrapNaturalW + 'px' },
    ], { duration: 1400, fill: 'forwards', easing: EASE })

    // A disc shrinks
    cancelEl(aDisc)
    A(aDisc, [
      { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' },
      { opacity: 0, transform: 'translate(-50%,-50%) scale(0.3)' },
    ], { duration: 550, delay: 200, fill: 'forwards', easing: 'ease-in' })

    // Text "a" returns
    cancelEl(sA)
    sA.textContent = 'a'
    sA.style.fontWeight = '500'
    A(sA, [
      { opacity: 0, filter: 'blur(2px)' },
      { opacity: 1, filter: 'blur(0px)' },
    ], { duration: 500, delay: 500, fill: 'forwards', easing: 'ease-out' })
  }, [size, clearAll, A, T, cancelEl])

  // ══ cycle: Intera → AI → pause → Intera... ══
  const cycle = useCallback(() => {
    toAI()
    T(() => {
      toIntera()
      cycleRef.current = setTimeout(cycle, CYCLE_PAUSE)
    }, 3200)
  }, [toAI, toIntera, T])

  // ── Main animation effect ──
  useEffect(() => {
    if (mode === 'none') return

    const prefersReduced = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) return

    const run = () => playIdle()

    if (document.fonts.status === 'loaded') {
      run()
    } else {
      document.fonts.ready.then(run)
    }

    return clearAll
  }, [mode, collapsed, size, theme, playIdle, clearAll])

  // ══ RENDER ══

  // mode='none': static, SSR-safe
  if (mode === 'none') {
    const color = textColor
    const fs = fontSize(size)
    if (collapsed) {
      return (
        <span
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, userSelect: 'none' }}
          aria-label="Intera"
        >
          <span style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontWeight: 500, fontSize: fs, color, lineHeight: 1 }}>I</span>
        </span>
      )
    }
    return (
      <span
        style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontWeight: 500, fontSize: fs, color, letterSpacing: '-0.02em', lineHeight: 1, userSelect: 'none', display: 'inline-flex', alignItems: 'baseline' }}
        aria-label="Intera"
      >
        Intera
      </span>
    )
  }

  // Animated lockup
  return (
    <div
      ref={stageRef}
      className="intera-logo-stage"
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none', flexShrink: 0 }}
      aria-label="Intera"
    >
      <div
        ref={lockupRef}
        style={{ display: 'flex', alignItems: 'center', gap: 0 }}
      />
    </div>
  )
}
