'use client'

import { Zap } from 'lucide-react'

export default function CoreNode() {
  return (
    <div className="flex flex-col items-center gap-2">
      {/* Glow */}
      <div style={{ position: 'relative', width: 64, height: 64 }}>
        <div
          style={{
            position: 'absolute',
            inset: -16,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(99,102,241,0.1) 0%, transparent 70%)',
          }}
        />

        {/* Glass circle */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: 'linear-gradient(145deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.3) 100%)',
            backdropFilter: 'blur(20px) saturate(1.3)',
            WebkitBackdropFilter: 'blur(20px) saturate(1.3)',
            border: '1px solid rgba(255,255,255,0.5)',
            boxShadow: `
              0 1px 2px rgba(0,0,0,0.04),
              0 4px 12px rgba(0,0,0,0.06),
              inset 0 1px 0 rgba(255,255,255,0.6)
            `,
          }}
        >
          {/* Top highlight */}
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

          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Zap
              size={22}
              strokeWidth={1.8}
              style={{ color: '#6366f1', position: 'relative', zIndex: 1 }}
            />
          </div>
        </div>

        {/* Accent ring */}
        <div
          style={{
            position: 'absolute',
            inset: -1,
            borderRadius: '50%',
            border: '1px solid rgba(99,102,241,0.12)',
            pointerEvents: 'none',
          }}
        />
      </div>

      <span
        className="text-[9px] font-bold uppercase tracking-[2px]"
        style={{ color: '#a5a8b4' }}
      >
        Core
      </span>
    </div>
  )
}
