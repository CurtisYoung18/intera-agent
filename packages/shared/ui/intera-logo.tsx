'use client'
import { useEffect, useState, useCallback } from 'react'

interface Props {
  collapsed?: boolean   // collapse to "I" (sidebar icon mode)
  size?: number         // font-size in px
}

const LETTERS = ['n', 't', 'e', 'r', 'a'] as const

export default function InteraLogo({ collapsed = false, size = 22 }: Props) {
  // Animation trigger — increments on mount and on every click
  const [tick, setTick] = useState(0)
  const [revealed, setRevealed] = useState(false)

  // Reveal on mount (visible delay so user can see the stagger)
  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 300)
    return () => clearTimeout(t)
  }, [])

  // Replay animation when `collapsed` prop changes
  useEffect(() => {
    setRevealed(false)
    setTick((t) => t + 1)
    const t = setTimeout(() => setRevealed(true), 80)
    return () => clearTimeout(t)
  }, [collapsed])

  // Click to replay the reveal animation
  const handleClick = useCallback(() => {
    setRevealed(false)
    setTick((t) => t + 1)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setRevealed(true)
      })
    })
  }, [])

  const isCollapsed = collapsed

  return (
    <span
      className={[
        'intera-logo',
        revealed ? 'is-revealed' : '',
        isCollapsed ? 'is-collapsed' : '',
      ].join(' ')}
      style={{ fontSize: size, cursor: 'default' }}
      aria-label="Intera"
      onClick={handleClick}
      title="Intera"
    >
      <span className="il-anchor">I</span>
      {LETTERS.map((ch, i) => (
        <span
          key={`${ch}-${tick}`}
          className="il-letter"
          style={{
            transitionDelay: `${(isCollapsed ? (LETTERS.length - 1 - i) : i) * 50}ms`,
          }}
        >
          {ch}
        </span>
      ))}
    </span>
  )
}
