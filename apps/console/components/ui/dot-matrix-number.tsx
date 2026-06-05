// LED dot-matrix number display — renders digits as a grid of small circles
// Used for large metric displays with a retro-digital aesthetic

'use client'

import { useMemo } from 'react'

const GLYPHS: Record<string, number[]> = {
  '0': [0,1,1,1,0, 1,0,0,0,1, 1,0,0,1,1, 1,0,1,0,1, 1,1,0,0,1, 1,0,0,0,1, 0,1,1,1,0],
  '1': [0,0,1,0,0, 0,1,1,0,0, 1,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 1,1,1,1,1],
  '2': [0,1,1,1,0, 1,0,0,0,1, 0,0,0,0,1, 0,0,1,1,0, 0,1,0,0,0, 1,0,0,0,0, 1,1,1,1,1],
  '3': [1,1,1,1,0, 0,0,0,0,1, 0,0,0,0,1, 0,1,1,1,0, 0,0,0,0,1, 0,0,0,0,1, 1,1,1,1,0],
  '4': [1,0,0,1,0, 1,0,0,1,0, 1,0,0,1,0, 1,1,1,1,1, 0,0,0,1,0, 0,0,0,1,0, 0,0,0,1,0],
  '5': [1,1,1,1,1, 1,0,0,0,0, 1,1,1,1,0, 0,0,0,0,1, 0,0,0,0,1, 1,0,0,0,1, 0,1,1,1,0],
  '6': [0,1,1,1,0, 1,0,0,0,0, 1,0,0,0,0, 1,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 0,1,1,1,0],
  '7': [1,1,1,1,1, 0,0,0,0,1, 0,0,0,1,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0],
  '8': [0,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 0,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 0,1,1,1,0],
  '9': [0,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 0,1,1,1,1, 0,0,0,0,1, 0,0,0,0,1, 0,1,1,1,0],
  ',': [0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,1,0,0, 0,1,0,0,0, 0,0,0,0,0],
  '.': [0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,1,1,0,0, 0,1,1,0,0],
  '%': [1,0,0,0,1, 0,0,0,1,0, 0,0,1,0,0, 0,1,0,0,0, 1,0,0,0,1, 0,0,0,0,0, 0,0,0,0,0],
  ':': [0,0,0,0,0, 0,1,1,0,0, 0,1,1,0,0, 0,0,0,0,0, 0,1,1,0,0, 0,1,1,0,0, 0,0,0,0,0],
}

interface DotMatrixNumberProps {
  value: string
  dotSize?: number
  gap?: number
  color?: string
  className?: string
}

export default function DotMatrixNumber({
  value,
  dotSize = 2,
  gap = 4.5,
  color = 'var(--mist)',
  className = '',
}: DotMatrixNumberProps) {
  const { svg, viewBox } = useMemo(() => {
    const chars = value.split('')
    const cols = 5
    const rows = 7
    const contentW = chars.length * (cols * gap) - gap
    const contentH = rows * gap
    const pad = dotSize * 2
    const totalW = contentW + pad * 2
    const totalH = contentH + pad * 2
    const circles: string[] = []

    chars.forEach((ch, ci) => {
      const grid = GLYPHS[ch]
      if (!grid) return
      const ox = ci * (cols * gap)
      grid.forEach((v, i) => {
        if (v) {
          const cx = pad + ox + (i % cols) * gap + gap / 2
          const cy = pad + Math.floor(i / cols) * gap + gap / 2
          circles.push(`<circle cx="${cx}" cy="${cy}" r="${dotSize}" fill="${color}"/>`)
        }
      })
    })

    return { svg: circles.join(''), viewBox: `0 0 ${totalW} ${totalH}` }
  }, [value, dotSize, gap, color])

  return (
    <svg
      viewBox={viewBox}
      className={`block ${className}`}
      style={{ maxWidth: '100%', maxHeight: '60px' }}
      aria-label={value}
      role="img"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
