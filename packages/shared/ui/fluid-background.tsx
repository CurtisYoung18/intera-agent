'use client'

// FluidBackground — animated fluid art with grain texture
//
// [MOCK] CSS canvas version with organic blobs and noise overlay.
// Production upgrade: WebGL fluid simulation with same public API.
//
// Layers:
//   1. Canvas — animated radial gradient blobs (slow organic movement)
//   2. SVG noise filter — grain/texture overlay
//   3. Radial vignette — darkens edges

import { useEffect, useRef, useCallback } from 'react'

interface FluidBackgroundProps {
  intensity?: 'subtle' | 'normal'
  interactive?: boolean
  overlayImage?: string
}

interface Blob {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  colors: string[]
  opacity: number
  phase: number
}

const DARK_PALETTES = [
  ['rgba(100, 80, 160, 0.12)', 'rgba(80, 60, 140, 0.06)', 'rgba(140, 100, 200, 0.04)'],
  ['rgba(60, 40, 100, 0.10)', 'rgba(40, 30, 80, 0.05)', 'rgba(100, 60, 160, 0.03)'],
  ['rgba(180, 60, 50, 0.04)', 'rgba(160, 40, 30, 0.02)', 'rgba(200, 80, 60, 0.02)'],
  ['rgba(200, 180, 140, 0.03)', 'rgba(180, 160, 120, 0.02)', 'rgba(220, 200, 160, 0.02)'],
  ['rgba(80, 100, 160, 0.08)', 'rgba(60, 80, 140, 0.04)', 'rgba(120, 140, 200, 0.03)'],
]

const LIGHT_PALETTES = [
  ['rgba(180, 140, 100, 0.10)', 'rgba(160, 120, 80, 0.05)', 'rgba(200, 160, 120, 0.03)'],
  ['rgba(140, 120, 90, 0.08)', 'rgba(120, 100, 70, 0.04)', 'rgba(160, 140, 100, 0.03)'],
  ['rgba(200, 160, 130, 0.06)', 'rgba(180, 140, 110, 0.03)', 'rgba(220, 180, 140, 0.02)'],
  ['rgba(160, 140, 180, 0.06)', 'rgba(140, 120, 160, 0.03)', 'rgba(180, 160, 200, 0.02)'],
  ['rgba(220, 200, 170, 0.05)', 'rgba(200, 180, 150, 0.03)', 'rgba(240, 220, 180, 0.02)'],
]

function createBlob(canvasW: number, canvasH: number, palettes: string[][]): Blob {
  return {
    x: Math.random() * canvasW,
    y: Math.random() * canvasH,
    vx: (Math.random() - 0.5) * 0.15,
    vy: (Math.random() - 0.5) * 0.15,
    size: 250 + Math.random() * 450,
    colors: palettes[Math.floor(Math.random() * palettes.length)],
    opacity: 0.3 + Math.random() * 0.5,
    phase: Math.random() * Math.PI * 2,
  }
}

export default function FluidBackground({
  intensity = 'normal',
  interactive = true,
  overlayImage,
}: FluidBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useRef({ x: -1000, y: -1000, tx: -1000, ty: -1000 })
  const blobsRef = useRef<Blob[]>([])
  const rafRef = useRef<number>(0)
  const timeRef = useRef(0)

  const isDarkRef = useRef(true)
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    timeRef.current += 0.003
    const isDark = isDarkRef.current

    // Fade trail — light or dark
    const fadeAlpha = intensity === 'subtle' ? 0.12 : 0.06
    ctx.fillStyle = isDark
      ? `rgba(8, 8, 10, ${fadeAlpha})`
      : `rgba(250, 250, 246, ${fadeAlpha})`
    ctx.fillRect(0, 0, w, h)

    // Smooth mouse following
    const mx = mouseRef.current.tx += (mouseRef.current.x - mouseRef.current.tx) * 0.05
    const my = mouseRef.current.ty += (mouseRef.current.y - mouseRef.current.ty) * 0.05

    for (const blob of blobsRef.current) {
      // Organic movement: sinusoidal drift + linear velocity
      const driftX = Math.sin(timeRef.current * 0.7 + blob.phase) * 0.3
      const driftY = Math.cos(timeRef.current * 0.5 + blob.phase) * 0.3
      blob.x += blob.vx + driftX
      blob.y += blob.vy + driftY

      // Wrap around
      if (blob.x < -blob.size) blob.x = w + blob.size
      if (blob.x > w + blob.size) blob.x = -blob.size
      if (blob.y < -blob.size) blob.y = h + blob.size
      if (blob.y > h + blob.size) blob.y = -blob.size

      // Mouse attraction (very subtle)
      if (interactive && mx > 0 && my > 0) {
        const dx = mx - blob.x
        const dy = my - blob.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 400) {
          const force = ((400 - dist) / 400) * 0.008
          blob.vx += dx * force * 0.0005
          blob.vy += dy * force * 0.0005
        }
      }

      // Damping
      blob.vx *= 0.9995
      blob.vy *= 0.9995

      // Multi-layer radial gradients for organic feel
      const [c1, c2, c3] = blob.colors
      const gradient = ctx.createRadialGradient(
        blob.x, blob.y, 0,
        blob.x, blob.y, blob.size,
      )
      gradient.addColorStop(0, c1)
      gradient.addColorStop(0.4, c2)
      gradient.addColorStop(0.7, c3)
      gradient.addColorStop(1, 'transparent')

      ctx.fillStyle = gradient
      ctx.globalAlpha = blob.opacity * (0.7 + 0.3 * Math.sin(timeRef.current * 0.3 + blob.phase))
      ctx.fillRect(
        blob.x - blob.size,
        blob.y - blob.size,
        blob.size * 2,
        blob.size * 2,
      )
    }
    ctx.globalAlpha = 1

    rafRef.current = requestAnimationFrame(draw)
  }, [intensity, interactive])

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

    const palettes = isDarkRef.current ? DARK_PALETTES : LIGHT_PALETTES
    const count = intensity === 'subtle' ? 3 : 6
    blobsRef.current = Array.from({ length: count }, () =>
      createBlob(canvas.width, canvas.height, palettes),
    )

    rafRef.current = requestAnimationFrame(draw)

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(rafRef.current)
    }
  }, [draw, intensity])

  // Watch theme changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const isDark = !document.documentElement.hasAttribute('data-theme') ||
        document.documentElement.getAttribute('data-theme') === 'dark'
      isDarkRef.current = isDark
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!interactive) return
    const onMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX
      mouseRef.current.y = e.clientY
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => window.removeEventListener('mousemove', onMove)
  }, [interactive])

  useEffect(() => {
    const interval = setInterval(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const palettes = isDarkRef.current ? DARK_PALETTES : LIGHT_PALETTES
      blobsRef.current.push(createBlob(canvas.width, canvas.height, palettes))
      const max = intensity === 'subtle' ? 6 : 10
      if (blobsRef.current.length > max) {
        blobsRef.current.shift()
      }
    }, intensity === 'subtle' ? 25000 : 14000)

    return () => clearInterval(interval)
  }, [intensity])

  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {/* Canvas layer — animated blobs */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
      />

      {/* SVG noise/grain overlay — tiled 256px texture avoids browser filter resolution limits on large viewports */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.035]" aria-hidden="true" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='256' height='256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='256' height='256' filter='url(%23g)'/%3E%3C/svg%3E")`, backgroundRepeat: 'repeat', backgroundSize: '256px 256px' }}>
        {/* noise rendered via CSS tiled background-image to stay within GPU texture limits */}
      </svg>

      {/* Radial vignette — styled in globals.css, responds to data-theme */}
      <div className="absolute inset-0 fluid-vignette" />

      {/* Optional image overlay */}
      {overlayImage && (
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: `url(${overlayImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            mixBlendMode: 'screen',
          }}
        />
      )}
    </div>
  )
}
