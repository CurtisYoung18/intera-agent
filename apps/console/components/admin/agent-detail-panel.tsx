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
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.03)',
          zIndex: 9,
          animation: 'fadeIn 0.25s ease-out',
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 300,
          zIndex: 10,
          background: 'linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0.72) 100%)',
          backdropFilter: 'blur(32px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(32px) saturate(1.5)',
          borderLeft: '1px solid rgba(0,0,0,0.06)',
          boxShadow: '-8px 0 40px rgba(0,0,0,0.06), -1px 0 0 rgba(255,255,255,0.5) inset',
          display: 'flex',
          flexDirection: 'column',
          padding: 28,
          animation: 'slideIn 0.3s cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        <style>{`
          @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
        `}</style>

        {/* Back */}
        <button
          type="button"
          onClick={onClose}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            fontWeight: 500,
            color: '#9ca3af',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            marginBottom: 20,
            transition: 'color 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#6b7280' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#9ca3af' }}
        >
          <ArrowLeft size={14} />
          Back
        </button>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              background: `linear-gradient(135deg, ${theme.bgFrom}, ${theme.bgTo})`,
              border: `1px solid ${theme.border}`,
            }}
          >
            <Icon size={22} strokeWidth={1.5} style={{ color: theme.color }} />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#1f2937', letterSpacing: '-0.01em' }}>
              {theme.label}
            </div>
            {subtitle && (
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                {subtitle}
              </div>
            )}
          </div>
        </div>

        {/* Categories */}
        {categories && categories.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {categories.map((cat) => (
              <div
                key={cat.label}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '10px 6px',
                  borderRadius: 12,
                  background: 'rgba(255,255,255,0.6)',
                  border: '1px solid rgba(0,0,0,0.04)',
                }}
              >
                <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1, color: cat.color }}>
                  {cat.count}
                </div>
                <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#9ca3af', marginTop: 4 }}>
                  {cat.label}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Rows */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {rows.map((row) => (
            <div
              key={row.label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '11px 0',
                borderBottom: '1px solid rgba(0,0,0,0.04)',
              }}
            >
              <span style={{ fontSize: 12, color: '#6b7280' }}>{row.label}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#1f2937' }}>{row.value}</span>
            </div>
          ))}

          {/* Tools / Items list */}
          {tools && tools.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {tools.map((tool) => (
                <div
                  key={tool}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 0',
                    fontSize: 12,
                    color: '#374151',
                  }}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: theme.color,
                      opacity: 0.6,
                    }}
                  />
                  {tool}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Open Settings button */}
        <a
          href={settingsPath}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            width: '100%',
            padding: '11px 0',
            borderRadius: 12,
            fontSize: 13,
            fontWeight: 500,
            textDecoration: 'none',
            marginTop: 16,
            border: '1px solid rgba(0,0,0,0.06)',
            background: 'rgba(255,255,255,0.7)',
            color: '#374151',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(99,102,241,0.06)'
            e.currentTarget.style.borderColor = 'rgba(99,102,241,0.2)'
            e.currentTarget.style.color = '#6366f1'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.7)'
            e.currentTarget.style.borderColor = 'rgba(0,0,0,0.06)'
            e.currentTarget.style.color = '#374151'
          }}
        >
          Open Settings
          <ArrowRight size={14} />
        </a>
      </div>
    </>
  )
}
