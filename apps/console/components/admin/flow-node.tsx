'use client'

import type { ReactNode } from 'react'

interface FlowNodeProps {
  id: string
  icon: ReactNode
  title: string
  subtitle?: string
  color?: 'lavender' | 'indigo' | 'amber' | 'malachite' | 'sky' | 'gold'
  active?: boolean
  onClick: () => void
  span?: 1 | 2 | 3
}

const colorMap = {
  lavender: { border: 'rgba(139,111,245,0.12)', hoverBorder: 'rgba(139,111,245,0.25)', glow: 'rgba(139,111,245,0.06)', icon: '#8b6ff5', dot: 'rgba(139,111,245,0.5)' },
  indigo:   { border: 'rgba(91,138,247,0.12)', hoverBorder: 'rgba(91,138,247,0.25)', glow: 'rgba(91,138,247,0.06)', icon: '#5b8af7', dot: 'rgba(91,138,247,0.5)' },
  amber:    { border: 'rgba(212,145,46,0.12)', hoverBorder: 'rgba(212,145,46,0.25)', glow: 'rgba(212,145,46,0.06)', icon: '#d4912e', dot: 'rgba(212,145,46,0.5)' },
  malachite:{ border: 'rgba(46,160,74,0.12)', hoverBorder: 'rgba(46,160,74,0.25)', glow: 'rgba(46,160,74,0.06)', icon: '#2ea04a', dot: 'rgba(46,160,74,0.5)' },
  sky:      { border: 'rgba(91,184,247,0.12)', hoverBorder: 'rgba(91,184,247,0.25)', glow: 'rgba(91,184,247,0.06)', icon: '#5bb8f7', dot: 'rgba(91,184,247,0.5)' },
  gold:     { border: 'rgba(184,148,76,0.12)', hoverBorder: 'rgba(184,148,76,0.25)', glow: 'rgba(184,148,76,0.06)', icon: '#b8944c', dot: 'rgba(184,148,76,0.5)' },
}

const spanMap = { 1: 'col-span-1', 2: 'col-span-2', 3: 'col-span-3' }

export default function FlowNode({ id, icon, title, subtitle, color = 'indigo', active, onClick, span = 1 }: FlowNodeProps) {
  const c = colorMap[color]
  return (
    <div id={`flow-node-${id}`} className={spanMap[span]}>
      <button
        onClick={onClick}
        className="w-full text-left glass-card p-5 cursor-pointer transition-[border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 focus:outline-none"
        style={{
          borderColor: active ? c.hoverBorder : c.border,
          boxShadow: active ? `0 0 20px ${c.glow}, 0 2px 16px rgba(0,0,0,0.04), 0 0 0 1px rgba(255,255,255,0.4) inset` : undefined,
        }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0" style={{ background: `linear-gradient(135deg, ${c.glow}, transparent)`, color: c.icon }}>
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-[var(--mist)]">{title}</div>
            {subtitle && <div className="text-[11px] text-[var(--fog)] mt-0.5">{subtitle}</div>}
          </div>
          <div className="w-2 h-2 rounded-full flex-shrink-0 animate-breathe" style={{ background: c.dot }} />
        </div>
      </button>
    </div>
  )
}
