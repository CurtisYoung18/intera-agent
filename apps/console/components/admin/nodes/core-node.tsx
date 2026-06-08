'use client'

import { Zap } from 'lucide-react'

export default function CoreNode() {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="flex items-center justify-center rounded-full"
        style={{
          width: 56,
          height: 56,
          background: 'rgba(255,255,255,0.7)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1.5px dashed rgba(99,102,241,0.25)',
          boxShadow: '0 2px 12px rgba(99,102,241,0.06)',
        }}
      >
        <Zap size={20} className="text-indigo-400/60" strokeWidth={1.8} />
      </div>
      <span
        className="text-[9px] font-semibold uppercase tracking-[1.2px]"
        style={{ color: '#a5a8b4' }}
      >
        Core
      </span>
    </div>
  )
}
