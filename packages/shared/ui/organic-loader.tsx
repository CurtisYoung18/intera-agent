'use client'

/**
 * OrganicLoader — 20-variant SVG loading indicator with goo-filter aesthetics.
 *
 * All animations use inline SMIL — zero CSS dependencies, fully self-contained.
 * Uses currentColor so the caller controls colour via className.
 *
 * Props:
 *   variant  1-20  direct selection (overrides icon)
 *   icon     semantic alias: scan→1, spin→2, pulse→12, dots→20
 *   size     rendered px (default 24)
 *   random   if true and no variant/icon given, picks a random variant on mount
 */

import { useId, useMemo } from 'react'
import type { SpinnerIcon } from '../types'

const ICON_TO_VARIANT: Record<SpinnerIcon, number> = {
  scan:  1,
  spin:  2,
  pulse: 12,
  dots:  20,
}

interface OrganicLoaderProps {
  icon?:    SpinnerIcon
  variant?: number          // 1–20
  size?:    number
  className?: string
}

export default function OrganicLoader({
  icon,
  variant,
  size = 24,
  className,
}: OrganicLoaderProps) {
  const rawId = useId()
  const filterId = `ol-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`

  // Resolve which variant to render
  const v = useMemo(() => {
    if (variant && variant >= 1 && variant <= 20) return variant
    if (icon) return ICON_TO_VARIANT[icon] ?? 2
    return 2
  }, [variant, icon])

  // Scale goo blur proportionally to rendered size (keeps merging effect visible)
  const blur = Math.max(0.7, size * 0.065)

  const Variant = VARIANTS[v - 1]

  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ display: 'block', flexShrink: 0, overflow: 'visible' }}
    >
      <defs>
        <filter id={filterId} x="-60%" y="-60%" width="220%" height="220%"
          colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="blur" />
          <feColorMatrix in="blur" type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9" />
        </filter>
        {/* Softer goo for loose-cluster animations */}
        <filter id={`${filterId}s`} x="-60%" y="-60%" width="220%" height="220%"
          colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation={Math.max(0.5, blur * 0.75)} result="blur" />
          <feColorMatrix in="blur" type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" />
        </filter>
      </defs>
      {Variant && <Variant fid={filterId} />}
    </svg>
  )
}

// ─── Shared helper types ──────────────────────────────────────────────────────
type VProps = { fid: string }
type VC = (p: VProps) => React.ReactElement

// ─── 01 · Metaball orbit ─────────────────────────────────────────────────────
// Two equal blobs slide toward each other, merging at centre.
const V01: VC = ({ fid }) => (
  <g filter={`url(#${fid})`}>
    <circle cx="16" cy="16" r="5.5" fill="currentColor">
      <animateTransform attributeName="transform" type="translate"
        values="-5,0; 5,0; -5,0" dur="1.8s"
        calcMode="spline" keySplines="0.5 0 0.5 1; 0.5 0 0.5 1"
        repeatCount="indefinite" />
    </circle>
    <circle cx="16" cy="16" r="5.5" fill="currentColor">
      <animateTransform attributeName="transform" type="translate"
        values="5,0; -5,0; 5,0" dur="1.8s"
        calcMode="spline" keySplines="0.5 0 0.5 1; 0.5 0 0.5 1"
        repeatCount="indefinite" />
    </circle>
  </g>
)

// ─── 02 · Three metaballs rotating ───────────────────────────────────────────
const V02: VC = ({ fid }) => (
  <g filter={`url(#${fid})`}>
    <g>
      <animateTransform attributeName="transform" type="rotate"
        from="0 16 16" to="360 16 16" dur="2s" repeatCount="indefinite" />
      <circle cx="16" cy="6.5"  r="4.5" fill="currentColor" />
      <circle cx="23.5" cy="20.5" r="4.5" fill="currentColor" />
      <circle cx="8.5"  cy="20.5" r="4.5" fill="currentColor" />
    </g>
  </g>
)

// ─── 03 · Breathing blob (SMIL path morph) ───────────────────────────────────
const V03: VC = () => (
  <path fill="currentColor" d="M16,5 C21,5 27,9 27,16 C27,23 21,27 16,27 C11,27 5,23 5,16 C5,9 11,5 16,5 Z">
    <animate attributeName="d" dur="5s" repeatCount="indefinite" values="
      M16,5 C22,5 27,10 27,16 C27,22 22,27 16,27 C10,27 5,22 5,16 C5,10 10,5 16,5 Z;
      M17,4 C23,5 28,12 26,18 C24,24 18,28 12,26 C7,24 4,18 6,12 C8,7 12,4 17,4 Z;
      M15,5 C21,4 27,9 27,15 C28,22 23,28 17,27 C11,26 5,22 5,15 C5,9 10,5 15,5 Z;
      M16,5 C22,5 27,10 27,16 C27,22 22,27 16,27 C10,27 5,22 5,16 C5,10 10,5 16,5 Z" />
  </path>
)

// ─── 04 · Squish bounce ──────────────────────────────────────────────────────
const V04: VC = () => (
  <ellipse cx="16" cy="16" rx="6" ry="6" fill="currentColor">
    <animateTransform attributeName="transform" type="translate"
      values="0,-8; 0,6; 0,-8" dur="1.4s"
      calcMode="spline" keySplines="0.6 0 0.4 1; 0.6 0 0.4 1"
      repeatCount="indefinite" additive="sum" />
    <animate attributeName="ry" values="6; 6; 3.5; 6" dur="1.4s"
      calcMode="spline" keySplines="0.5 0 0.5 1; 0.2 0 0.2 1; 0.5 0 0.5 1"
      repeatCount="indefinite" />
    <animate attributeName="rx" values="6; 6; 8.5; 6" dur="1.4s"
      calcMode="spline" keySplines="0.5 0 0.5 1; 0.2 0 0.2 1; 0.5 0 0.5 1"
      repeatCount="indefinite" />
  </ellipse>
)

// ─── 05 · Splat pulse ────────────────────────────────────────────────────────
const V05: VC = ({ fid }) => (
  <g filter={`url(#${fid}s)`}>
    <g>
      <animateTransform attributeName="transform" type="scale"
        values="0.5 0.5; 1 1; 0.5 0.5" dur="2s" additive="sum"
        calcMode="spline" keySplines="0.5 0 0.5 1; 0.5 0 0.5 1"
        repeatCount="indefinite" />
      <circle cx="16" cy="16" r="6"  fill="currentColor" />
      <circle cx="9"  cy="11" r="2.5" fill="currentColor" />
      <circle cx="24" cy="13" r="2"   fill="currentColor" />
      <circle cx="11" cy="23" r="2"   fill="currentColor" />
      <circle cx="22" cy="22" r="2.5" fill="currentColor" />
      <circle cx="16" cy="8"  r="1.8" fill="currentColor" />
    </g>
  </g>
)

// ─── 06 · Goo trail chase ────────────────────────────────────────────────────
// 5 dots orbit the centre, each a step behind the last.
const V06: VC = ({ fid }) => {
  const delays = ['0s', '-0.12s', '-0.24s', '-0.36s', '-0.48s']
  const radii  = [4.5, 3.8, 3.2, 2.7, 2.2]
  return (
    <g filter={`url(#${fid})`}>
      {delays.map((begin, i) => (
        <g key={i}>
          <animateTransform attributeName="transform" type="rotate"
            from="0 16 16" to="360 16 16" dur="1.6s" begin={begin}
            repeatCount="indefinite" />
          <circle cx="16" cy="7" r={radii[i]} fill="currentColor" />
        </g>
      ))}
    </g>
  )
}

// ─── 07 · Mitosis split ──────────────────────────────────────────────────────
const V07: VC = ({ fid }) => (
  <g filter={`url(#${fid})`}>
    <circle cx="16" cy="16" r="5.5" fill="currentColor">
      <animateTransform attributeName="transform" type="translate"
        values="0,0; -6,0; 0,0; 6,0; 0,0" dur="2.2s"
        calcMode="spline"
        keySplines="0.5 0 0.5 1; 0.5 0 0.5 1; 0.5 0 0.5 1; 0.5 0 0.5 1"
        repeatCount="indefinite" />
    </circle>
    <circle cx="16" cy="16" r="5.5" fill="currentColor">
      <animateTransform attributeName="transform" type="translate"
        values="0,0; 6,0; 0,0; -6,0; 0,0" dur="2.2s"
        calcMode="spline"
        keySplines="0.5 0 0.5 1; 0.5 0 0.5 1; 0.5 0 0.5 1; 0.5 0 0.5 1"
        repeatCount="indefinite" />
    </circle>
  </g>
)

// ─── 08 · Inkdrop fall ───────────────────────────────────────────────────────
const V08: VC = ({ fid }) => (
  <g filter={`url(#${fid}s)`}>
    {/* falling drop */}
    <ellipse cx="16" cy="16" rx="3" ry="3.5" fill="currentColor">
      <animateTransform attributeName="transform" type="translate"
        values="0,-9; 0,7; 0,7" dur="2s"
        calcMode="spline" keySplines="0.4 0 0.6 1; 0.5 0 0.5 1"
        repeatCount="indefinite" />
      <animate attributeName="ry" values="3.5; 3.5; 1.5" dur="2s"
        calcMode="spline" keySplines="0.5 0 0.5 1; 0.2 0 0.2 1"
        repeatCount="indefinite" />
      <animate attributeName="rx" values="3; 3; 5" dur="2s"
        calcMode="spline" keySplines="0.5 0 0.5 1; 0.2 0 0.2 1"
        repeatCount="indefinite" />
      <animate attributeName="opacity" values="0; 1; 1; 0" dur="2s"
        keyTimes="0; 0.1; 0.7; 1" repeatCount="indefinite" />
    </ellipse>
    {/* splash pool */}
    <ellipse cx="16" cy="23" rx="1" ry="0.5" fill="currentColor">
      <animate attributeName="rx" values="0; 7; 0" dur="2s"
        calcMode="spline" keySplines="0.2 0 0.8 1; 0.5 0 0.5 1"
        repeatCount="indefinite" begin="0.65s" />
      <animate attributeName="opacity" values="0; 0.7; 0" dur="2s"
        repeatCount="indefinite" begin="0.65s" />
    </ellipse>
  </g>
)

// ─── 09 · Lava rise ──────────────────────────────────────────────────────────
const V09: VC = ({ fid }) => {
  const blobs = [
    { cx: 12, delay: '0s' },
    { cx: 20, delay: '-0.8s' },
    { cx: 16, delay: '-1.6s' },
  ]
  return (
    <g filter={`url(#${fid})`}>
      {blobs.map(({ cx, delay }, i) => (
        <circle key={i} cx={cx} cy="16" r="4.5" fill="currentColor">
          <animateTransform attributeName="transform" type="translate"
            values="0,8; 0,0; 0,-8" dur="2.4s" begin={delay}
            calcMode="spline" keySplines="0.5 0 0.5 1; 0.5 0 0.5 1"
            repeatCount="indefinite" />
          <animate attributeName="opacity" values="0; 1; 0" dur="2.4s"
            begin={delay} repeatCount="indefinite" />
        </circle>
      ))}
      {/* pool base */}
      <rect x="6" y="25" width="20" height="4" rx="2" fill="currentColor" />
    </g>
  )
}

// ─── 10 · Wobble jelly (SMIL morph, faster) ──────────────────────────────────
const V10: VC = () => (
  <path fill="currentColor" d="M16,7 C21,7 25,11 25,16 C25,21 21,25 16,25 C11,25 7,21 7,16 C7,11 11,7 16,7 Z">
    <animate attributeName="d" dur="2.4s" repeatCount="indefinite" values="
      M16,7 C21,7 25,11 25,16 C25,21 21,25 16,25 C11,25 7,21 7,16 C7,11 11,7 16,7 Z;
      M16,6 C22,7 26,12 25,18 C24,23 19,26 14,25 C9,23 6,18 7,13 C8,8 11,6 16,6 Z;
      M16,7 C22,7 26,13 24,18 C22,24 17,26 12,24 C8,22 6,17 8,12 C10,8 11,7 16,7 Z;
      M16,7 C21,7 25,11 25,16 C25,21 21,25 16,25 C11,25 7,21 7,16 C7,11 11,7 16,7 Z" />
  </path>
)

// ─── 11 · Petals rotate ──────────────────────────────────────────────────────
const V11: VC = ({ fid }) => (
  <g filter={`url(#${fid})`}>
    <g>
      <animateTransform attributeName="transform" type="rotate"
        from="0 16 16" to="360 16 16" dur="3s" repeatCount="indefinite" />
      <circle cx="16" cy="16" r="4"  fill="currentColor" />
      <circle cx="16" cy="7"  r="3"  fill="currentColor" />
      <circle cx="16" cy="25" r="3"  fill="currentColor" />
      <circle cx="7"  cy="16" r="3"  fill="currentColor" />
      <circle cx="25" cy="16" r="3"  fill="currentColor" />
    </g>
  </g>
)

// ─── 12 · Pulse rings ────────────────────────────────────────────────────────
const V12: VC = () => {
  const begins = ['0s', '-0.8s', '-1.6s']
  return (
    <g>
      {begins.map((begin, i) => (
        <circle key={i} cx="16" cy="16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <animate attributeName="r"       from="3"   to="14"  dur="2.4s" begin={begin} repeatCount="indefinite" />
          <animate attributeName="opacity" from="0.85" to="0"  dur="2.4s" begin={begin} repeatCount="indefinite" />
        </circle>
      ))}
    </g>
  )
}

// ─── 13 · Two-blob eclipse ───────────────────────────────────────────────────
// Large and small blob slide through each other.
const V13: VC = ({ fid }) => (
  <g filter={`url(#${fid})`}>
    <circle cx="16" cy="16" r="6" fill="currentColor">
      <animateTransform attributeName="transform" type="translate"
        values="-6,0; 6,0; -6,0" dur="2.6s"
        calcMode="spline" keySplines="0.4 0 0.6 1; 0.4 0 0.6 1"
        repeatCount="indefinite" />
    </circle>
    <circle cx="16" cy="16" r="4" fill="currentColor">
      <animateTransform attributeName="transform" type="translate"
        values="5,0; -5,0; 5,0" dur="2.6s"
        calcMode="spline" keySplines="0.4 0 0.6 1; 0.4 0 0.6 1"
        repeatCount="indefinite" />
    </circle>
  </g>
)

// ─── 14 · Bubble stream ──────────────────────────────────────────────────────
const V14: VC = ({ fid }) => {
  const bubbles = [
    { cx: 16, r: 4,   begin: '0s'     },
    { cx: 12, r: 3,   begin: '-0.55s' },
    { cx: 20, r: 2.5, begin: '-1.1s'  },
    { cx: 16, r: 2,   begin: '-1.65s' },
  ]
  return (
    <g filter={`url(#${fid}s)`}>
      {bubbles.map(({ cx, r, begin }, i) => (
        <circle key={i} cx={cx} cy="16" r={r} fill="currentColor">
          <animateTransform attributeName="transform" type="translate"
            values="0,9; 0,-9" dur="2.2s" begin={begin}
            calcMode="spline" keySplines="0.3 0 0.7 1"
            repeatCount="indefinite" />
          <animate attributeName="opacity"
            values="0; 1; 0.8; 0" keyTimes="0; 0.15; 0.7; 1"
            dur="2.2s" begin={begin} repeatCount="indefinite" />
        </circle>
      ))}
    </g>
  )
}

// ─── 15 · Stretch & snap ─────────────────────────────────────────────────────
const V15: VC = ({ fid }) => (
  <g filter={`url(#${fid})`}>
    {/* left blob */}
    <circle cx="16" cy="16" r="4.5" fill="currentColor">
      <animateTransform attributeName="transform" type="translate"
        values="-5,0; -5,0; 0,0; -5,0" dur="2s" keyTimes="0; 0.4; 0.5; 1"
        repeatCount="indefinite" />
    </circle>
    {/* right blob */}
    <circle cx="16" cy="16" r="4.5" fill="currentColor">
      <animateTransform attributeName="transform" type="translate"
        values="5,0; 5,0; 0,0; 5,0" dur="2s" keyTimes="0; 0.4; 0.5; 1"
        repeatCount="indefinite" />
    </circle>
    {/* bridge */}
    <ellipse cx="16" cy="16" rx="5" ry="2.5" fill="currentColor">
      <animate attributeName="rx" values="5; 0; 5" dur="2s"
        keyTimes="0; 0.5; 1" repeatCount="indefinite" />
      <animate attributeName="opacity" values="1; 0; 1" dur="2s"
        keyTimes="0; 0.5; 1" repeatCount="indefinite" />
    </ellipse>
  </g>
)

// ─── 16 · Rolling blob ───────────────────────────────────────────────────────
const V16: VC = () => (
  <g>
    <ellipse cx="16" cy="20" rx="7" ry="5" fill="currentColor">
      <animateTransform attributeName="transform" type="translate"
        values="-7,0; 7,0; -7,0" dur="1.8s"
        calcMode="spline" keySplines="0.5 0 0.5 1; 0.5 0 0.5 1"
        repeatCount="indefinite" />
    </ellipse>
    {/* shadow / track */}
    <ellipse cx="16" cy="25" rx="8" ry="1.5" fill="currentColor" opacity="0.15" />
  </g>
)

// ─── 17 · Goo cluster pulse ──────────────────────────────────────────────────
const V17: VC = ({ fid }) => {
  const corners = [
    { cx: 9,  cy: 9,  delay: '0s'      },
    { cx: 23, cy: 9,  delay: '-0.45s'  },
    { cx: 9,  cy: 23, delay: '-0.9s'   },
    { cx: 23, cy: 23, delay: '-1.35s'  },
  ]
  return (
    <g filter={`url(#${fid})`}>
      {corners.map(({ cx, cy, delay }, i) => (
        <circle key={i} cx={cx} cy={cy} r="4.5" fill="currentColor">
          <animateTransform attributeName="transform" type="scale"
            values="0.7 0.7; 1.1 1.1; 0.7 0.7" dur="1.8s" begin={delay} additive="sum"
            calcMode="spline" keySplines="0.5 0 0.5 1; 0.5 0 0.5 1"
            repeatCount="indefinite" />
        </circle>
      ))}
    </g>
  )
}

// ─── 18 · Wave perimeter ─────────────────────────────────────────────────────
const V18: VC = () => (
  <path fill="currentColor" d="">
    <animate attributeName="d" dur="3.6s" repeatCount="indefinite" values="
      M16,5 C22,5 27,10 27,16 C27,22 22,27 16,27 C10,27 5,22 5,16 C5,10 10,5 16,5 Z;
      M16,6 C23,5 27,12 26,18 C25,24 20,28 14,26 C9,24 4,18 6,13 C8,8 10,6 16,6 Z;
      M16,5 C22,6 28,12 27,18 C26,24 20,28 14,27 C9,26 4,21 5,15 C6,9 10,4 16,5 Z;
      M16,6 C22,5 28,10 27,16 C27,23 21,28 15,26 C9,24 4,18 5,12 C6,7 10,6 16,6 Z;
      M16,5 C22,5 27,10 27,16 C27,22 22,27 16,27 C10,27 5,22 5,16 C5,10 10,5 16,5 Z" />
  </path>
)

// ─── 19 · Stretch oscillate ──────────────────────────────────────────────────
const V19: VC = () => (
  <ellipse cx="16" cy="16" rx="8" ry="8" fill="currentColor">
    <animate attributeName="rx" values="8; 12; 8; 5; 8"  dur="2.4s"
      calcMode="spline"
      keySplines="0.5 0 0.5 1; 0.5 0 0.5 1; 0.5 0 0.5 1; 0.5 0 0.5 1"
      repeatCount="indefinite" />
    <animate attributeName="ry" values="8; 5; 8; 12; 8"  dur="2.4s"
      calcMode="spline"
      keySplines="0.5 0 0.5 1; 0.5 0 0.5 1; 0.5 0 0.5 1; 0.5 0 0.5 1"
      repeatCount="indefinite" />
  </ellipse>
)

// ─── 20 · Caterpillar wave ────────────────────────────────────────────────────
const V20: VC = ({ fid }) => {
  const xs     = [4.5, 12, 19.5, 27]
  const begins = ['0s', '-0.3s', '-0.6s', '-0.9s']
  return (
    <g filter={`url(#${fid})`}>
      {xs.map((cx, i) => (
        <circle key={cx} cx={cx} cy="16" r="3" fill="currentColor">
          <animate attributeName="r" values="2;4.5;2" dur="1.2s" begin={begins[i]}
            calcMode="spline" keySplines="0.5 0 0.5 1; 0.5 0 0.5 1"
            repeatCount="indefinite" />
        </circle>
      ))}
    </g>
  )
}

// Ordered array so VARIANTS[v-1] maps 1-20
const VARIANTS: VC[] = [
  V01, V02, V03, V04, V05, V06, V07, V08, V09, V10,
  V11, V12, V13, V14, V15, V16, V17, V18, V19, V20,
]

/** Total number of available variants — useful for random selection at call sites. */
export const ORGANIC_LOADER_COUNT = 20
