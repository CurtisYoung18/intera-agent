// Animated wave/line chart — SVG-based with CSS stroke-dashoffset animation
// Displays a smooth curve with gradient stroke

'use client'

import { useEffect, useRef, useState, useMemo } from 'react'

interface WaveChartProps {
  data: number[]
  height?: number
  color?: string
  gradientFrom?: string
  gradientTo?: string
  className?: string
}

export default function WaveChart({
  data,
  height = 100,
  color,
  gradientFrom = 'var(--malachite)',
  gradientTo = 'var(--sky)',
  className = '',
}: WaveChartProps) {
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

  const pathD = useMemo(() => {
    if (data.length < 2) return ''
    const max = Math.max(...data, 1)
    const min = Math.min(...data, 0)
    const range = max - min || 1
    const padY = 8
    const padX = 4
    const w = 300
    const usableW = w - padX * 2
    const usableH = height - padY * 2

    const points = data.map((v, i) => ({
      x: padX + (i / (data.length - 1)) * usableW,
      y: padY + usableH - ((v - min) / range) * usableH,
    }))

    let d = `M ${points[0].x} ${points[0].y}`
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1]
      const curr = points[i]
      const cpx = (prev.x + curr.x) / 2
      d += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`
    }
    return d
  }, [data, height])

  const gradId = useMemo(() => `wg-${Math.random().toString(36).slice(2, 8)}`, [])

  return (
    <div ref={ref} className={className}>
      <svg viewBox={`0 0 300 ${height}`} width="100%" height={height} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={gradientFrom} />
            <stop offset="100%" stopColor={gradientTo} />
          </linearGradient>
        </defs>
        <path
          d={pathD}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={4}
          strokeLinecap="round"
          opacity={0.2}
          style={{
            filter: 'blur(4px)',
            strokeDasharray: 1000,
            strokeDashoffset: animated ? 0 : 1000,
            transition: 'stroke-dashoffset 2s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
        <path
          d={pathD}
          fill="none"
          stroke={color || `url(#${gradId})`}
          strokeWidth={2.5}
          strokeLinecap="round"
          style={{
            strokeDasharray: 1000,
            strokeDashoffset: animated ? 0 : 1000,
            transition: 'stroke-dashoffset 2s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      </svg>
    </div>
  )
}
