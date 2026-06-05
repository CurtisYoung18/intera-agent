// Animated number counter — counts from 0 to target with easing
// Triggered by IntersectionObserver

'use client'

import { useEffect, useRef, useState } from 'react'

interface AnimatedCounterProps {
  target: number
  duration?: number
  decimals?: number
  className?: string
  children: (value: string) => React.ReactNode
}

export default function AnimatedCounter({
  target,
  duration = 1200,
  decimals = 0,
  className = '',
  children,
}: AnimatedCounterProps) {
  const [current, setCurrent] = useState(0)
  const [started, setStarted] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setStarted(true); obs.disconnect() } },
      { threshold: 0.3 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!started) return
    const start = performance.now()
    const animate = (now: number) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setCurrent(eased * target)
      if (progress < 1) requestAnimationFrame(animate)
    }
    requestAnimationFrame(animate)
  }, [started, target, duration])

  const display = decimals > 0
    ? current.toFixed(decimals)
    : Math.round(current).toLocaleString()

  return (
    <div ref={ref} className={className}>
      {children(display)}
    </div>
  )
}
