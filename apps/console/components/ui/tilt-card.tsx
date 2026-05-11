'use client'

import type { ReactNode } from 'react'

interface TiltCardProps {
  children: ReactNode
  accentColor?: string
  onClick?: () => void
  className?: string
}

export default function TiltCard({ children, accentColor, onClick, className = '' }: TiltCardProps) {
  return (
    <div
      onClick={onClick}
      className={`group relative cursor-pointer transition-[transform,box-shadow] duration-300 ease-out
        hover:-translate-y-1 hover:shadow-xl
        bg-white/70 backdrop-blur-xl border border-black/5 rounded-xl
        ${className}`}
      style={{
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        transform: 'perspective(800px) rotateX(0deg)',
      }}
      onMouseMove={e => {
        const card = e.currentTarget
        const rect = card.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        const centerX = rect.width / 2
        const centerY = rect.height / 2
        const rotateX = ((y - centerY) / centerY) * -4
        const rotateY = ((x - centerX) / centerX) * 4
        card.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px)`
        card.style.boxShadow = `
          ${-rotateY * 2}px ${rotateX * 2}px 20px rgba(0,0,0,0.06),
          0 4px 16px rgba(0,0,0,0.08)
        `
      }}
      onMouseLeave={e => {
        const card = e.currentTarget
        card.style.transform = 'perspective(800px) rotateX(0deg) rotateY(0deg) translateY(0px)'
        card.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)'
      }}
    >
      {/* Accent bar */}
      {accentColor && (
        <div className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full opacity-50 group-hover:opacity-100 transition-opacity"
          style={{ backgroundColor: accentColor }} />
      )}
      {children}
    </div>
  )
}
