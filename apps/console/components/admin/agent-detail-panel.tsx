'use client'

import { ArrowLeft, ArrowRight } from 'lucide-react'
import { type ModuleId, THEMES } from './nodes/module-node'

interface DetailRow {
  label: string
  value: string
}

interface AgentDetailPanelProps {
  moduleId: ModuleId
  subtitle?: string
  rows: DetailRow[]
  categories?: { label: string; count: number; color: string }[]
  tools?: string[]
  settingsPath: string
  onClose: () => void
}

export default function AgentDetailPanel({
  moduleId,
  subtitle,
  rows,
  categories,
  tools,
  settingsPath,
  onClose,
}: AgentDetailPanelProps) {
  const theme = THEMES[moduleId]
  const Icon = theme.icon

  return (
    <div
      className="absolute right-0 top-0 bottom-0 flex flex-col"
      style={{
        width: 280,
        background: 'rgba(255,255,255,0.88)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderLeft: '1px solid rgba(0,0,0,0.06)',
        borderRadius: '0 20px 20px 0',
        padding: 24,
        zIndex: 10,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.04)',
        animation: 'slideIn 0.3s ease-out',
      }}
    >
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>

      <button
        type="button"
        onClick={onClose}
        className="inline-flex items-center gap-1 text-xs transition-colors hover:text-gray-600 mb-4"
        style={{ color: '#9ca3af' }}
      >
        <ArrowLeft size={14} />
        Back
      </button>

      <div className="flex items-center gap-3 mb-5">
        <div
          className="flex items-center justify-center rounded-xl flex-shrink-0"
          style={{
            width: 40,
            height: 40,
            background: `linear-gradient(135deg, ${theme.bgFrom}, ${theme.bgTo})`,
          }}
        >
          <Icon size={20} strokeWidth={1.8} style={{ color: theme.color }} />
        </div>
        <div>
          <div className="text-[15px] font-semibold" style={{ color: '#1f2937' }}>
            {theme.label}
          </div>
          {subtitle && (
            <div className="text-[11px]" style={{ color: '#9ca3af' }}>
              {subtitle}
            </div>
          )}
        </div>
      </div>

      {categories && categories.length > 0 && (
        <div className="flex gap-1.5 mb-3.5">
          {categories.map((cat) => (
            <div
              key={cat.label}
              className="flex-1 text-center py-2 px-1 rounded-[10px]"
              style={{
                border: '1px solid rgba(0,0,0,0.06)',
                background: 'rgba(255,255,255,0.6)',
              }}
            >
              <div className="text-lg font-bold leading-tight" style={{ color: cat.color }}>
                {cat.count}
              </div>
              <div className="text-[8px] uppercase tracking-wider" style={{ color: '#9ca3af' }}>
                {cat.label}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex justify-between items-center py-2 text-xs"
            style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}
          >
            <span style={{ color: '#6b7280' }}>{row.label}</span>
            <span className="font-semibold" style={{ color: '#1f2937' }}>{row.value}</span>
          </div>
        ))}

        {tools && tools.length > 0 && (
          <div className="mt-2">
            {tools.map((tool) => (
              <div key={tool} className="flex items-center gap-1.5 py-1.5 text-xs" style={{ color: '#374151' }}>
                <span
                  className="w-[5px] h-[5px] rounded-full flex-shrink-0"
                  style={{ background: '#22c55e' }}
                />
                {tool}
              </div>
            ))}
          </div>
        )}
      </div>

      <a
        href={settingsPath}
        className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl text-[13px] font-medium transition-all mt-auto no-underline"
        style={{
          border: '1px solid rgba(0,0,0,0.08)',
          background: 'rgba(255,255,255,0.8)',
          backdropFilter: 'blur(8px)',
          color: '#374151',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(99,102,241,0.06)'
          e.currentTarget.style.borderColor = 'rgba(99,102,241,0.2)'
          e.currentTarget.style.color = '#6366f1'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.8)'
          e.currentTarget.style.borderColor = 'rgba(0,0,0,0.08)'
          e.currentTarget.style.color = '#374151'
        }}
      >
        Open Settings
        <ArrowRight size={14} />
      </a>
    </div>
  )
}
