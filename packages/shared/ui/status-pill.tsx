// StatusPill — capsule status indicator for agent state
//
// thinking:  pulsing dot + radar ping ring (like CC's "agent is thinking" indicator)
// executing: conic-gradient ring spinner (design spec §3.4 + §6.2)
// online:    solid breathing dot
// waiting:   static amber dot
// offline:   static grey dot

type AgentStatus = 'online' | 'thinking' | 'executing' | 'waiting' | 'offline'

interface StatusPillProps {
  status: AgentStatus
  label: string
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  online:    'Online',
  thinking:  'Thinking',
  executing: 'Working',
  waiting:   'Waiting',
  offline:   'Offline',
}

export default function StatusPill({ status, label }: StatusPillProps) {
  return (
    <div className="glass-pill inline-flex items-center gap-2 px-4 py-2">
      {/* ── thinking: radar ping ring around dot ── */}
      {status === 'thinking' && (
        <span className="relative inline-flex items-center justify-center w-3 h-3 flex-shrink-0">
          {/* Ping ring — expands outward */}
          <span className="absolute inset-0 rounded-full bg-indigo/30 animate-ping-ring" />
          {/* Core dot — breathes */}
          <span className="relative w-[6px] h-[6px] rounded-full bg-indigo animate-breathe" />
        </span>
      )}

      {/* ── executing: conic ring spinner (spec §6.2) ── */}
      {status === 'executing' && (
        <span className="inline-block w-3 h-3 rounded-full flex-shrink-0 animate-tool-spin"
          style={{
            background: 'conic-gradient(from 0deg, transparent, #d4912e)',
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px))',
            WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px))',
          }}
        />
      )}

      {/* ── online / waiting / offline: simple dot ── */}
      {status === 'online' && (
        <span className="inline-block w-[6px] h-[6px] rounded-full flex-shrink-0 bg-malachite animate-breathe" />
      )}
      {status === 'waiting' && (
        <span className="inline-block w-[6px] h-[6px] rounded-full flex-shrink-0 bg-amber" />
      )}
      {status === 'offline' && (
        <span className="inline-block w-[6px] h-[6px] rounded-full flex-shrink-0 bg-smoke" />
      )}

      {/* Label */}
      <span className="text-xs font-sans font-normal tracking-[0.04em] uppercase text-fog select-none">
        {label}
      </span>
      {/* Status text (hidden on very small screens) */}
      <span className="hidden sm:inline text-[11px] font-sans text-smoke tracking-[0.03em] uppercase">
        · {STATUS_LABEL[status]}
      </span>
    </div>
  )
}
