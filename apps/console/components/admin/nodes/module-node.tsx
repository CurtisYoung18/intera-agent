'use client'

import {
  BrainCircuit,
  Database,
  Wrench,
  Shield,
  Users,
  type LucideIcon,
} from 'lucide-react'

export type ModuleId = 'brain' | 'memory' | 'tools' | 'guardrails' | 'caseAgents'

interface ModuleTheme {
  icon: LucideIcon
  label: string
  color: string
  bgFrom: string
  bgTo: string
  border: string
}

const THEMES: Record<ModuleId, ModuleTheme> = {
  brain: {
    icon: BrainCircuit,
    label: 'Brain',
    color: '#dc2626',
    bgFrom: 'rgba(254,226,226,0.8)',
    bgTo: 'rgba(252,165,165,0.45)',
    border: 'rgba(239,68,68,0.2)',
  },
  memory: {
    icon: Database,
    label: 'Memory',
    color: '#d97706',
    bgFrom: 'rgba(254,243,199,0.8)',
    bgTo: 'rgba(252,211,77,0.4)',
    border: 'rgba(245,158,11,0.2)',
  },
  tools: {
    icon: Wrench,
    label: 'Tools',
    color: '#2563eb',
    bgFrom: 'rgba(219,234,254,0.8)',
    bgTo: 'rgba(147,197,253,0.45)',
    border: 'rgba(59,130,246,0.2)',
  },
  guardrails: {
    icon: Shield,
    label: 'Guardrails',
    color: '#16a34a',
    bgFrom: 'rgba(220,252,231,0.8)',
    bgTo: 'rgba(134,239,172,0.4)',
    border: 'rgba(34,197,94,0.2)',
  },
  caseAgents: {
    icon: Users,
    label: 'Case Agents',
    color: '#db2777',
    bgFrom: 'rgba(251,207,232,0.8)',
    bgTo: 'rgba(244,114,182,0.4)',
    border: 'rgba(236,72,153,0.2)',
  },
}

interface ModuleNodeProps {
  data: {
    moduleId: ModuleId
    subtitle?: string
    dimmed?: boolean
    onClick?: (moduleId: ModuleId) => void
  }
}

export default function ModuleNode({ data }: ModuleNodeProps) {
  const { moduleId, subtitle, dimmed, onClick } = data
  const theme = THEMES[moduleId]
  const Icon = theme.icon

  return (
    <div
      className="flex flex-col items-center gap-2 cursor-pointer select-none"
      style={{ opacity: dimmed ? 0.4 : 1, transition: 'opacity 0.3s' }}
      onClick={() => onClick?.(moduleId)}
    >
      <div
        className="relative flex items-center justify-center rounded-[20px] overflow-hidden"
        style={{
          width: 72,
          height: 72,
          background: `linear-gradient(145deg, ${theme.bgFrom}, ${theme.bgTo})`,
          border: `1px solid ${theme.border}`,
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          transition: 'transform 0.25s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.3s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.06)'
          e.currentTarget.style.boxShadow = `0 8px 32px ${theme.color}18`
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)'
          e.currentTarget.style.boxShadow = 'none'
        }}
      >
        <div
          className="absolute inset-0 rounded-[20px] pointer-events-none"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.5) 0%, transparent 60%)',
          }}
        />
        <Icon size={24} strokeWidth={1.8} style={{ color: theme.color, position: 'relative', zIndex: 1 }} />
      </div>
      <span className="text-xs font-semibold" style={{ color: theme.color }}>
        {theme.label}
      </span>
      {subtitle && (
        <span className="text-[10px]" style={{ color: '#9ca3af' }}>
          {subtitle}
        </span>
      )}
    </div>
  )
}

export { THEMES }
export type { ModuleTheme }
