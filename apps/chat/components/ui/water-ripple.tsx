'use client'

// WaterRipple — interactive mouse-driven ripple canvas
// Creates expanding circles from cursor position, simulating
// water surface disturbance. Ripples accumulate and fade.

import { useEffect, useRef, useCallback } from 'react'

interface Ripple {
  x: number
  y: number
  radius: number
  maxRadius: number
  opacity: number
  speed: number
}

interface WaterRippleProps {
  intensity?: 'subtle' | 'normal'
  className?: string
}

const MAX_RIPPLES = 40
const MOUSE_RIPPLE_INTERVAL = 120 // ms between mouse-move ripples

export default function WaterRipple({
  intensity = 'normal',
  className = '',
}: WaterRippleProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ripplesRef = useRef<Ripple[]>([])
  const mouseRef = useRef({ x: -1000, y: -1000 })
  const lastRippleRef = useRef(0)
  const rafRef = useRef<number>(0)
  const isDarkRef = useRef(true)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    const isDark = isDarkRef.current

    // Clear with fading trail
    ctx.fillStyle = 'rgba(0, 0, 0, 0.08)'
    ctx.fillRect(0, 0, w, h)
    ctx.clearRect(0, 0, w, h)

    // Actually use composite for water-like additive blending
    ctx.globalCompositeOperation = 'lighter'

    // Update and draw ripples
    const ripples = ripplesRef.current
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i]
      r.radius += r.speed
      r.opacity -= 0.008

      if (r.opacity <= 0 || r.radius > r.maxRadius) {
        ripples.splice(i, 1)
        continue
      }

      // Draw expanding ring
      const progress = r.radius / r.maxRadius
      const alpha = r.opacity * (1 - progress)

      ctx.beginPath()
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2)

      // Clamp r0 to non-negative
      const r0 = Math.max(0, r.radius - 4)
      const gradient = ctx.createRadialGradient(
        r.x, r.y, r0,
        r.x, r.y, r.radius + 2,
      )
      if (isDark) {
        gradient.addColorStop(0, `rgba(255, 255, 255, 0)`)
        gradient.addColorStop(0.4, `rgba(255, 255, 255, ${alpha * 0.15})`)
        gradient.addColorStop(1, `rgba(255, 255, 255, 0)`)
      } else {
        gradient.addColorStop(0, `rgba(80, 60, 40, 0)`)
        gradient.addColorStop(0.4, `rgba(80, 60, 40, ${alpha * 0.12})`)
        gradient.addColorStop(1, `rgba(80, 60, 40, 0)`)
      }
      ctx.strokeStyle = gradient
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    ctx.globalCompositeOperation = 'source-over'

    rafRef.current = requestAnimationFrame(draw)
  }, [])

  // Init canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const resize = () => {
      const parent = canvas.parentElement
      const w = parent ? parent.clientWidth : window.innerWidth
      const h = parent ? parent.clientHeight : window.innerHeight
      canvas.width = w * devicePixelRatio
      canvas.height = h * devicePixelRatio
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.scale(devicePixelRatio, devicePixelRatio)
    }
    resize()
    window.addEventListener('resize', resize)

    rafRef.current = requestAnimationFrame(draw)

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(rafRef.current)
    }
  }, [draw])

  // Mouse ripple generation
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX
      mouseRef.current.y = e.clientY

      const now = Date.now()
      if (now - lastRippleRef.current < MOUSE_RIPPLE_INTERVAL) return
      lastRippleRef.current = now

      const ripples = ripplesRef.current
      if (ripples.length > MAX_RIPPLES) ripples.shift()

      ripples.push({
        x: e.clientX,
        y: e.clientY,
        radius: 0,
        maxRadius: 60 + Math.random() * 40,
        opacity: 0.7,
        speed: 1.5 + Math.random() * 1.5,
      })
    }

    const onClick = (e: MouseEvent) => {
      const ripples = ripplesRef.current
      // Larger ripple on click
      for (let i = 0; i < 3; i++) {
        ripples.push({
          x: e.clientX + (Math.random() - 0.5) * 30,
          y: e.clientY + (Math.random() - 0.5) * 30,
          radius: 0,
          maxRadius: 120 + Math.random() * 80,
          opacity: 0.9,
          speed: 2.5 + Math.random() * 2,
        })
      }
      // Cap
      while (ripples.length > MAX_RIPPLES) ripples.shift()
    }

    window.addEventListener('mousemove', onMove, { passive: true })
    window.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('click', onClick)
    }
  }, [])

  // Watch theme changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      isDarkRef.current = !document.documentElement.hasAttribute('data-theme') ||
        document.documentElement.getAttribute('data-theme') === 'dark'
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className={`fixed inset-0 z-[2] pointer-events-none ${className}`}
      aria-hidden="true"
    />
  )
}
