'use client'

/**
 * OrganicLoader — 4-variant SVG loading indicator with goo-filter aesthetics.
 *
 * Variants (map to SpinnerIcon):
 *   scan  — Two metaballs orbiting each other (scanning / checking data)
 *   dots  — Wave of 4 pulsing blobs (thinking / general progress)
 *   spin  — Three metaballs rotating in a triangle (working / processing)
 *   pulse — Concentric ripple rings expanding outward (escalating / preparing)
 *
 * All animations use inline SMIL — zero CSS dependencies, fully self-contained.
 * Uses currentColor for fill/stroke so the caller controls color via className.
 */

import { useId } from 'react'
import type { SpinnerIcon } from '../types'

interface OrganicLoaderProps {
  icon?: SpinnerIcon
  size?: number
  className?: string
}

export default function OrganicLoader({
  icon = 'spin',
  size = 24,
  className,
}: OrganicLoaderProps) {
  const rawId = useId()
  // useId returns strings like ":r0:" — sanitize to a valid CSS/SVG id
  const filterId = `ol-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`

  // Scale goo blur to match rendered size (keeps merging effect proportional)
  const blur = Math.max(0.7, size * 0.065)

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
        {/* Goo filter: Gaussian blur + alpha threshold creates blob-merging effect */}
        <filter
          id={filterId}
          x="-60%"
          y="-60%"
          width="220%"
          height="220%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            // Amplify alpha channel: blobs merge where their blur fields overlap
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9"
          />
        </filter>
      </defs>

      {icon === 'scan'  && <ScanBlobs  filterId={filterId} />}
      {icon === 'dots'  && <DotsWave   filterId={filterId} />}
      {icon === 'spin'  && <SpinTriple filterId={filterId} />}
      {icon === 'pulse' && <PulseRings />}
    </svg>
  )
}

// ─── Variant: scan ────────────────────────────────────────────────────────────
// Two equal blobs orbit horizontally, merging in the middle via goo filter.
function ScanBlobs({ filterId }: { filterId: string }) {
  const shared = {
    dur: '1.8s',
    calcMode: 'spline' as const,
    keySplines: '0.5 0 0.5 1; 0.5 0 0.5 1',
    repeatCount: 'indefinite' as const,
  }
  return (
    <g filter={`url(#${filterId})`}>
      <circle cx="16" cy="16" r="5.5" fill="currentColor">
        <animateTransform
          attributeName="transform"
          type="translate"
          values="-5,0; 5,0; -5,0"
          {...shared}
        />
      </circle>
      <circle cx="16" cy="16" r="5.5" fill="currentColor">
        <animateTransform
          attributeName="transform"
          type="translate"
          values="5,0; -5,0; 5,0"
          {...shared}
        />
      </circle>
    </g>
  )
}

// ─── Variant: dots ────────────────────────────────────────────────────────────
// Four blobs in a row pulse with staggered delays — goo makes them merge when large.
function DotsWave({ filterId }: { filterId: string }) {
  const xs  = [4.5, 12, 19.5, 27]
  const begins = ['0s', '-0.3s', '-0.6s', '-0.9s']
  return (
    <g filter={`url(#${filterId})`}>
      {xs.map((cx, i) => (
        <circle key={cx} cx={cx} cy="16" r="3" fill="currentColor">
          <animate
            attributeName="r"
            values="2;4.5;2"
            dur="1.2s"
            begin={begins[i]}
            calcMode="spline"
            keySplines="0.5 0 0.5 1; 0.5 0 0.5 1"
            repeatCount="indefinite"
          />
        </circle>
      ))}
    </g>
  )
}

// ─── Variant: spin ────────────────────────────────────────────────────────────
// Three metaballs arranged in a triangle rotate around the center.
function SpinTriple({ filterId }: { filterId: string }) {
  return (
    <g filter={`url(#${filterId})`}>
      {/* Rotating group — animateTransform must be a direct child */}
      <g>
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 16 16"
          to="360 16 16"
          dur="2s"
          repeatCount="indefinite"
        />
        <circle cx="16"  cy="6.5"  r="4.5" fill="currentColor" />
        <circle cx="23.5" cy="20.5" r="4.5" fill="currentColor" />
        <circle cx="8.5"  cy="20.5" r="4.5" fill="currentColor" />
      </g>
    </g>
  )
}

// ─── Variant: pulse ───────────────────────────────────────────────────────────
// Three concentric rings expand outward and fade — no goo filter (stroke-based).
function PulseRings() {
  const begins = ['0s', '-0.8s', '-1.6s']
  return (
    <g>
      {begins.map((begin, i) => (
        <circle
          key={i}
          cx="16"
          cy="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <animate
            attributeName="r"
            from="3"
            to="14"
            dur="2.4s"
            begin={begin}
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            from="0.85"
            to="0"
            dur="2.4s"
            begin={begin}
            repeatCount="indefinite"
          />
        </circle>
      ))}
    </g>
  )
}
