// Animated circular ring progress — SVG-based with CSS transition
// Shows a percentage as a filling arc with a center label

'use client'

import { useEffect, useRef, useState } from 'react'

interface RingProgressProps {
  value: number
  size?: number
  strokeWidth?: number
  color?: string
  trackColor?: string
  label?: string
  showValue?: boolean
  className?: string
}

export default function RingProgress({
  value,
  size = 180,
  strokeWidth = 8,
  color = 'var(--indigo)',
  trackColor = 'rgba(0,0,0,0.04)',
  label,
  showValue = true,
  className = '',
}: RingProgressProps) {
  const [animated, setAnimated] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setAnimated(true); obs.disconnect() } },
      { threshold: 0.3 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const r = (size - strokeWidth) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (animated ? (value / 100) * circ : 0)

  return (
    <div ref={ref} className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {showValue && (
          <span className="text-[28px] font-bold tracking-[-0.02em] text-[var(--mist)]">
            {animated ? value : 0}%
          </span>
        )}
        {label && (
          <span className="text-[11px] text-[var(--fog)] mt-0.5">{label}</span>
        )}
      </div>
    </div>
  )
}
