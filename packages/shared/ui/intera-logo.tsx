'use client'
import { useCallback, useEffect, useRef } from 'react'

interface InteraLogoProps {
  size?: number
  collapsed?: boolean
  mode?: 'idle' | 'none'
  theme?: 'light' | 'dark'
  showTag?: boolean
}

type Coord = [number, number]

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
const SOFT = 'cubic-bezier(0.16, 1, 0.3, 1)'
const BACK = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
const CYCLE_ACTIVE_END = 4400
const LOOP_REST_MS = 5000
const CYCLE_HOLD_END = CYCLE_ACTIVE_END + LOOP_REST_MS
const SCATTER: Coord[] = [
  [-72, -44],
  [58, -66],
  [84, 16],
  [-50, 58],
  [22, 78],
  [-86, -6],
  [40, -30],
  [-26, -72],
  [66, 54],
  [6, -86],
  [-60, 30],
]

const NS = 'http://www.w3.org/2000/svg'

interface LogoRefs {
  svg: SVGSVGElement
  ring: SVGPathElement
  ringWrap: SVGGElement
  markGlow: SVGCircleElement
  iStem: SVGRectElement
  iDot: SVGCircleElement
  dotGlow: SVGCircleElement
  apertureGroup: SVGGraphicsElement
  dotGroup: SVGGElement
  dots: Array<{ el: SVGCircleElement, vx: number, vy: number }>
}

function createLogoElements(size: number, theme: 'light' | 'dark', uid: string): LogoRefs {
  const colorText = theme === 'dark' ? '#f8fbfd' : '#1b2c33'
  const markFill = theme === 'dark' ? '#6bcdd4' : '#14b8a6'
  const stemA = theme === 'dark' ? '#d6f6ff' : '#16282e'
  const stemB = theme === 'dark' ? '#9de8ff' : '#244852'

  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 220 220')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('fill', 'none')
  svg.setAttribute('aria-label', 'Intera mark')
  svg.style.flexShrink = '0'

  const defs = document.createElementNS(NS, 'defs')
  defs.innerHTML = `
    <linearGradient id="ringGrad-${uid}" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="${colorText}"/>
      <stop offset="0.5" stop-color="#2f8f99"/>
      <stop offset="1" stop-color="#7fcdd4"/>
    </linearGradient>
    <linearGradient id="stemGrad-${uid}" x1="0" y1="1" x2="0.4" y2="0">
      <stop offset="0" stop-color="${stemA}"/>
      <stop offset="1" stop-color="${stemB}"/>
    </linearGradient>
    <radialGradient id="glowGrad-${uid}" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="rgba(47,159,170,0.55)"/>
      <stop offset="1" stop-color="rgba(47,159,170,0)"/>
    </radialGradient>
    <radialGradient id="dotGlow-${uid}" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="rgba(74,200,210,0.9)"/>
      <stop offset="1" stop-color="rgba(74,200,210,0)"/>
    </radialGradient>
  `
  svg.appendChild(defs)

  const markGlow = document.createElementNS(NS, 'circle')
  markGlow.setAttribute('cx', '110')
  markGlow.setAttribute('cy', '110')
  markGlow.setAttribute('r', '92')
  markGlow.setAttribute('fill', `url(#glowGrad-${uid})`)
  markGlow.setAttribute('opacity', '0')
  markGlow.style.transform = 'translateZ(0)'
  markGlow.style.transformBox = 'view-box'
  markGlow.style.transformOrigin = '110px 110px'
  svg.appendChild(markGlow)

  const apertureGroup = document.createElementNS(NS, 'g') as unknown as SVGGraphicsElement
  apertureGroup.style.opacity = '0'
  apertureGroup.style.transformBox = 'view-box'
  apertureGroup.style.transformOrigin = '110px 110px'

  for (let i = 0; i < 6; i++) {
    const a0 = (i * 60) * Math.PI / 180
    const a1 = (i * 60 + 118) * Math.PI / 180
    const r = 62
    const x0 = 110 + r * Math.cos(a0)
    const y0 = 110 + r * Math.sin(a0)
    const x1 = 110 + r * Math.cos(a1)
    const y1 = 110 + r * Math.sin(a1)
    const line = document.createElementNS(NS, 'line')
    line.setAttribute('x1', x0.toFixed(1))
    line.setAttribute('y1', y0.toFixed(1))
    line.setAttribute('x2', x1.toFixed(1))
    line.setAttribute('y2', y1.toFixed(1))
    line.setAttribute('stroke', '#5bb6bf')
    line.setAttribute('stroke-width', '1.3')
    line.setAttribute('stroke-linecap', 'round')
    apertureGroup.appendChild(line)
  }
  svg.appendChild(apertureGroup)

  const dotGroup = document.createElementNS(NS, 'g') as SVGGElement
  const dots: Array<{ el: SVGCircleElement, vx: number, vy: number }> = []
  SCATTER.forEach((pair, index) => {
    const circle = document.createElementNS(NS, 'circle')
    const radius = 3.6 + (index % 3) * 1.4
    circle.setAttribute('cx', '110')
    circle.setAttribute('cy', '110')
    circle.setAttribute('r', radius.toFixed(1))
    circle.setAttribute('fill', index % 2 ? '#3a98a3' : '#6cc4cc')
    circle.style.opacity = '0'
    circle.style.transformBox = 'view-box'
    circle.style.transformOrigin = '110px 110px'
    dots.push({ el: circle, vx: pair[0], vy: pair[1] })
    dotGroup.appendChild(circle)
  })
  svg.appendChild(dotGroup)

  const ringWrap = document.createElementNS(NS, 'g') as unknown as SVGGElement
  ringWrap.style.transformBox = 'view-box'
  ringWrap.style.transformOrigin = '110px 110px'
  const ring = document.createElementNS(NS, 'path')
  ring.setAttribute('d', 'M136.2,174.9 A70,70 0 1 1 171.8,142.9')
  ring.setAttribute('stroke', `url(#ringGrad-${uid})`)
  ring.setAttribute('stroke-width', '16')
  ring.setAttribute('stroke-linecap', 'round')
  ring.setAttribute('fill', 'none')
  ringWrap.appendChild(ring)
  svg.appendChild(ringWrap)

  const dotGlow = document.createElementNS(NS, 'circle')
  dotGlow.setAttribute('cx', '109')
  dotGlow.setAttribute('cy', '82')
  dotGlow.setAttribute('r', '17')
  dotGlow.setAttribute('fill', `url(#dotGlow-${uid})`)
  dotGlow.setAttribute('opacity', '0')
  dotGlow.style.transformBox = 'view-box'
  dotGlow.style.transformOrigin = '109px 82px'
  svg.appendChild(dotGlow)

  const iStem = document.createElementNS(NS, 'rect')
  iStem.setAttribute('x', '101.5')
  iStem.setAttribute('y', '100')
  iStem.setAttribute('width', '15')
  iStem.setAttribute('height', '51')
  iStem.setAttribute('rx', '7.5')
  iStem.setAttribute('fill', `url(#stemGrad-${uid})`)
  iStem.style.opacity = '0'
  iStem.style.transform = 'scaleY(0)'
  iStem.style.transformBox = 'view-box'
  iStem.style.transformOrigin = '109px 151px'
  svg.appendChild(iStem)

  const iDot = document.createElementNS(NS, 'circle')
  iDot.setAttribute('cx', '109')
  iDot.setAttribute('cy', '82')
  iDot.setAttribute('r', '9.2')
  iDot.setAttribute('fill', markFill)
  iDot.style.opacity = '0'
  iDot.style.transformBox = 'view-box'
  iDot.style.transformOrigin = '109px 82px'
  svg.appendChild(iDot)

  return {
    svg,
    ring,
    ringWrap,
    markGlow,
    iStem,
    iDot,
    dotGlow,
    apertureGroup,
    dotGroup,
    dots,
  }
}

export default function InteraLogo({
  size = 26,
  collapsed = false,
  mode = 'none',
  theme = 'light',
  showTag = false,
}: InteraLogoProps) {
  const lockupRef = useRef<HTMLDivElement>(null)
  const cycleRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const animsRef = useRef<Animation[]>([])

  const stopPlayback = useCallback(() => {
    if (cycleRef.current !== null) {
      clearInterval(cycleRef.current)
      cycleRef.current = null
    }
    animsRef.current.forEach((a) => {
      try {
        a.cancel()
      } catch {}
    })
    animsRef.current = []
  }, [])

  const animateElement = useCallback((
    el: Element,
    keyframes: Keyframe[] | PropertyIndexedKeyframes,
    options: KeyframeAnimationOptions = {},
  ) => {
    const anim = el.animate(keyframes, {
      fill: 'both',
      easing: EASE,
      ...options,
    })
    animsRef.current.push(anim)
    return anim
  }, [])

  useEffect(() => {
    if (mode === 'none') return

    const lockup = lockupRef.current
    if (!lockup) return
    stopPlayback()

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const iconPx = Math.round(size * 2.15)
    const gapPx = Math.max(8, Math.round(size * 0.3))
    const wordPx = Math.max(10, Math.round(size * 0.90))
    const tagPx = Math.max(8, Math.round(size * 0.12))
    const wordColor = theme === 'dark' ? '#f8fbfd' : '#1d2e36'
    const tagColor = theme === 'dark' ? '#78d6de' : '#5aa6b0'
    const uid = `ctx-${Math.random().toString(36).slice(2, 11)}`
    const logo = createLogoElements(iconPx, theme, uid)

    lockup.innerHTML = ''
    lockup.style.display = 'flex'
    lockup.style.alignItems = 'center'
    lockup.style.gap = `${gapPx}px`
    lockup.style.overflow = 'hidden'

    const wordWrap = document.createElement('div')
    wordWrap.style.cssText = [
      'display:inline-flex;',
      'flex-direction:column;',
      `gap:${showTag ? Math.max(6, Math.round(size * 0.09)) : 0}px;`,
      'line-height:0.9;',
    ].join('')

    const word = document.createElement('div')
    word.style.cssText = 'display:inline-flex;white-space:pre;'

    const letters = [...'intera'].map((ch) => {
      const span = document.createElement('span')
      span.textContent = ch
      span.style.cssText = [
        'display:inline-block;',
        'font-family:var(--font-sans);',
        `font-size:${wordPx}px;`,
        'font-weight:500;',
        'letter-spacing:-0.018em;',
        `color:${wordColor};`,
        'opacity:0;',
        'transform:translateY(10px) translateX(-5px);',
      ].join('')
      word.appendChild(span)
      return span
    })

    const tag = document.createElement('div')
    if (showTag) {
      tag.textContent = 'AI Agent Studio'
      tag.style.cssText = [
        'font-family:var(--font-sans);',
        `font-size:${tagPx}px;`,
        'font-weight:600;',
        'letter-spacing:0.42em;',
        `color:${tagColor};`,
        'text-transform:uppercase;',
        'padding-left:3px;',
        'opacity:0;',
        'transform:translateY(7px);',
        'white-space:nowrap;',
      ].join('')
    }

    wordWrap.appendChild(word)
    if (showTag) wordWrap.appendChild(tag)
    lockup.appendChild(logo.svg)
    lockup.appendChild(wordWrap)
    const { dots, ring, ringWrap, markGlow, iStem, iDot, dotGlow, apertureGroup } = logo

    if (reduceMotion) {
      const ringLen = ring.getTotalLength()
      logo.dotGroup.style.opacity = '0'
      logo.ring.style.strokeDasharray = String(ringLen)
      logo.ring.style.strokeDashoffset = '0'
      logo.ringWrap && (logo.ringWrap.style.transform = 'scale(1)')
      logo.markGlow.style.opacity = '0'
      logo.apertureGroup.style.opacity = '0'
      logo.iStem.style.opacity = '1'
      logo.iStem.style.transform = 'scaleY(1)'
      logo.iDot.style.opacity = '1'
      logo.iDot.style.transform = 'translateY(0px) scale(1)'
      logo.dotGlow.style.opacity = '0'
      letters.forEach((el) => {
        el.style.opacity = '1'
        el.style.transform = 'translateY(0px) translateX(0px)'
      })
      if (showTag) {
        tag.style.opacity = '1'
        tag.style.transform = 'translateY(0px)'
      }
      return
    }

    animateElement(logo.dotGroup, [
      { transform: 'translate(0px, 0px) scale(1)', opacity: 0, offset: 0 },
      { opacity: .95, offset: .14 },
      { transform: 'translate(0px, 0px) scale(1)', opacity: .95, offset: .4 },
      { transform: 'translate(0px, 0px) scale(.18)', opacity: 0, offset: 1 },
    ], {
      duration: 1600,
      delay: 0,
      easing: 'cubic-bezier(.5,0,.75,0)',
    })

    dots.forEach(({ el, vx, vy }, i) => {
      animateElement(el, [
        { transform: `translate(${vx}px, ${vy}px) scale(1)`, opacity: 0, offset: 0 },
        { opacity: .95, offset: .14 },
        { transform: `translate(${(vx * 0.92).toFixed(1)}px, ${(vy * 0.92).toFixed(1)}px) scale(1)`, opacity: .95, offset: .4 },
        { transform: 'translate(0px, 0px) scale(.18)', opacity: 0, offset: 1 },
      ], {
        duration: 1600,
        delay: i * 24,
        easing: 'cubic-bezier(.5,0,.75,0)',
      })
    })

    animateElement(apertureGroup, [
      { opacity: 0, transform: 'rotate(-55deg) scale(.7)', offset: 0 },
      { opacity: .42, transform: 'rotate(-22deg) scale(.95)', offset: .32 },
      { opacity: .34, transform: 'rotate(0deg) scale(1.04)', offset: .62 },
      { opacity: 0, transform: 'rotate(14deg) scale(1.12)', offset: 1 },
    ], {
      duration: 1200,
      delay: 820,
    })

    animateElement(ring, [
      { strokeDashoffset: ring.getTotalLength(), opacity: 0, offset: 0 },
      { opacity: 1, offset: .04 },
      { strokeDashoffset: 0, opacity: 1, offset: 1 },
    ], {
      duration: 900,
      delay: 1200,
    })
    ring.style.strokeDasharray = String(ring.getTotalLength())

    animateElement(ringWrap, [
      { transform: 'scale(.965)', offset: 0 },
      { transform: 'scale(1.035)', offset: .6 },
      { transform: 'scale(1)', offset: 1 },
    ], {
      duration: 620,
      delay: 2050,
    })

    animateElement(markGlow, [
      { opacity: 0, transform: 'scale(.8)', offset: 0 },
      { opacity: 0.5, transform: 'scale(1.05)', offset: .4 },
      { opacity: 0.12, transform: 'scale(1)', offset: 1 },
    ], {
      duration: 700,
      delay: 2950,
      easing: SOFT,
    })

    animateElement(iStem, [
      { transform: 'scaleY(0)', opacity: 0, offset: 0 },
      { opacity: 1, offset: .18 },
      { transform: 'scaleY(1)', opacity: 1, offset: 1 },
    ], {
      duration: 520,
      delay: 2200,
    })

    animateElement(iDot, [
      { transform: 'translateY(-26px) scale(.35)', opacity: 0, offset: 0 },
      { opacity: 1, offset: .3 },
      { transform: 'translateY(0) scale(1)', opacity: 1, offset: 1 },
    ], {
      duration: 520,
      delay: 2620,
      easing: BACK,
    })

    animateElement(dotGlow, [
      { opacity: 0, transform: 'scale(.4)', offset: 0 },
      { opacity: .85, transform: 'scale(1)', offset: .45 },
      { opacity: 0, transform: 'scale(1.5)', offset: 1 },
    ], {
      duration: 620,
      delay: 2780,
      easing: SOFT,
    })

    letters.forEach((el, i) => {
      animateElement(el, [
        { opacity: 0, transform: 'translateY(10px) translateX(-5px)', offset: 0 },
        { opacity: 1, transform: 'translateY(0px) translateX(0px)', offset: 1 },
      ], {
        duration: 460,
        delay: 3180 + i * 68,
        easing: SOFT,
      })
    })

    if (showTag) {
      animateElement(tag, [
        { opacity: 0, transform: 'translateY(7px)', offset: 0 },
        { opacity: 1, transform: 'translateY(0px)', offset: 1 },
      ], {
        duration: 560,
        delay: 3760,
        easing: SOFT,
      })
    }

    cycleRef.current = setInterval(() => {
      animsRef.current.forEach((animation) => {
        try {
          animation.cancel()
          animation.play()
        } catch {}
      })
    }, CYCLE_HOLD_END)

    return stopPlayback
  }, [mode, size, theme, showTag, animateElement, stopPlayback])

  if (mode === 'none') {
    const color = theme === 'dark' ? '#f8fbfd' : '#1a1814'
    const fs = Math.round(size * 0.76)
    if (collapsed) {
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: size,
            height: size,
            userSelect: 'none',
          }}
          aria-label="Intera"
        >
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 500,
              fontSize: fs,
              color,
              lineHeight: 1,
            }}
          >
            i
          </span>
        </span>
      )
    }

    return (
      <span
        style={{
          fontFamily: 'var(--font-sans)',
          fontWeight: 500,
          fontSize: fs,
          color,
          letterSpacing: '-0.02em',
          lineHeight: 1,
          userSelect: 'none',
          display: 'inline-flex',
          alignItems: 'baseline',
        }}
        aria-label="Intera"
      >
        intera
      </span>
    )
  }

  return (
    <div
      ref={lockupRef}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
        flexShrink: 0,
      }}
      aria-label="Intera"
    />
  )
}
