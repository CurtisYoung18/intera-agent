'use client'
import { useEffect, useState } from 'react'

interface Props {
  collapsed?: boolean   // collapse to "I" (sidebar icon mode)
  size?: number         // font-size in px
  phase?: 'intera' | 'ia' | 'ai'  // forced phase (omit for default behaviour)
}

export default function InteraLogo({ collapsed = false, size = 22, phase }: Props) {
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 60)
    return () => clearTimeout(t)
  }, [])

  const isCollapsed = collapsed

  return (
    <span
      className={[
        'intera-logo',
        revealed ? 'is-revealed' : '',
        isCollapsed ? 'is-collapsed' : '',
      ].join(' ')}
      style={{ fontSize: size }}
      aria-label="Intera"
    >
      <span className="il-anchor">I</span>
      {'ntera'.split('').map((ch, i) => (
        <span
          key={i}
          className="il-letter"
          style={{ transitionDelay: `${(isCollapsed ? (4 - i) : i) * 28}ms` }}
        >
          {ch}
        </span>
      ))}
    </span>
  )
}
