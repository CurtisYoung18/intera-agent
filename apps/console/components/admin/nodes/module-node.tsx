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
  glow: string
}

const THEMES: Record<ModuleId, ModuleTheme> = {
  brain: {
    icon: BrainCircuit,
    label: 'Brain',
    color: '#e11d48',
    bgFrom: 'rgba(255,255,255,0.12)',
    bgTo: 'rgba(225,29,72,0.06)',
    border: 'rgba(225,29,72,0.15)',
    glow: 'rgba(225,29,72,0.12)',
  },
  memory: {
    icon: Database,
    label: 'Memory',
    color: '#d97706',
    bgFrom: 'rgba(255,255,255,0.12)',
    bgTo: 'rgba(217,119,6,0.06)',
    border: 'rgba(217,119,6,0.15)',
    glow: 'rgba(217,119,6,0.12)',
  },
  tools: {
    icon: Wrench,
    label: 'Tools',
    color: '#2563eb',
    bgFrom: 'rgba(255,255,255,0.12)',
    bgTo: 'rgba(37,99,235,0.06)',
    border: 'rgba(37,99,235,0.15)',
    glow: 'rgba(37,99,235,0.12)',
  },
  guardrails: {
    icon: Shield,
    label: 'Guardrails',
    color: '#16a34a',
    bgFrom: 'rgba(255,255,255,0.12)',
    bgTo: 'rgba(22,163,74,0.06)',
    border: 'rgba(22,163,74,0.15)',
    glow: 'rgba(22,163,74,0.12)',
  },
  caseAgents: {
    icon: Users,
    label: 'Case Agents',
    color: '#db2777',
    bgFrom: 'rgba(255,255,255,0.12)',
    bgTo: 'rgba(219,39,119,0.06)',
    border: 'rgba(219,39,119,0.15)',
    glow: 'rgba(219,39,119,0.12)',
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
      className="flex flex-col items-center gap-3 cursor-pointer select-none"
      style={{
        opacity: dimmed ? 0.3 : 1,
        transition: 'opacity 0.4s cubic-bezier(0.4,0,0.2,1)',
        filter: dimmed ? 'blur(1px)' : 'none',
      }}
      onClick={() => onClick?.(moduleId)}
    >
      {/* Outer glow ring */}
      <div
        style={{
          position: 'relative',
          width: 88,
          height: 88,
        }}
      >
        {/* Soft glow behind */}
        <div
          style={{
            position: 'absolute',
            inset: -12,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${theme.glow} 0%, transparent 70%)`,
            transition: 'opacity 0.3s',
            opacity: dimmed ? 0 : 1,
          }}
        />

        {/* Main glass circle */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: `linear-gradient(145deg, rgba(255,255,255,0.65) 0%, rgba(255,255,255,0.25) 100%)`,
            backdropFilter: 'blur(24px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(24px) saturate(1.4)',
            border: `1px solid rgba(255,255,255,0.5)`,
            boxShadow: `
              0 1px 2px rgba(0,0,0,0.04),
              0 4px 16px rgba(0,0,0,0.06),
              inset 0 1px 0 rgba(255,255,255,0.6),
              inset 0 -1px 0 rgba(0,0,0,0.02)
            `,
            transition: 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.35s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.08)'
            e.currentTarget.style.boxShadow = `
              0 2px 4px rgba(0,0,0,0.04),
              0 8px 32px ${theme.glow},
              inset 0 1px 0 rgba(255,255,255,0.7),
              inset 0 -1px 0 rgba(0,0,0,0.02)
            `
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)'
            e.currentTarget.style.boxShadow = `
              0 1px 2px rgba(0,0,0,0.04),
              0 4px 16px rgba(0,0,0,0.06),
              inset 0 1px 0 rgba(255,255,255,0.6),
              inset 0 -1px 0 rgba(0,0,0,0.02)
            `
          }}
        >
          {/* Top highlight arc */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: '15%',
              right: '15%',
              height: '45%',
              borderRadius: '0 0 50% 50%',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.5) 0%, transparent 100%)',
              pointerEvents: 'none',
            }}
          />

          {/* Icon */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon
              size={28}
              strokeWidth={1.5}
              style={{ color: theme.color, position: 'relative', zIndex: 1 }}
            />
          </div>
        </div>

        {/* Thin accent ring */}
        <div
          style={{
            position: 'absolute',
            inset: -1,
            borderRadius: '50%',
            border: `1px solid ${theme.border}`,
            pointerEvents: 'none',
            transition: 'opacity 0.3s',
            opacity: dimmed ? 0 : 0.6,
          }}
        />
      </div>

      {/* Label */}
      <div className="flex flex-col items-center gap-0.5">
        <span
          className="text-[12px] font-semibold tracking-wide"
          style={{ color: dimmed ? '#9ca3af' : theme.color }}
        >
          {theme.label}
        </span>
        {subtitle && (
          <span
            className="text-[10px] font-medium"
            style={{ color: dimmed ? '#d1d5db' : '#9ca3af' }}
          >
            {subtitle}
          </span>
        )}
      </div>
    </div>
  )
}

export { THEMES }
export type { ModuleTheme }
