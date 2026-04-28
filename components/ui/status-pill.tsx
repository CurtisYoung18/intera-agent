// StatusPill — capsule status indicator for agent state

type AgentStatus = 'online' | 'thinking' | 'executing' | 'waiting' | 'offline'

interface StatusPillProps {
  status: AgentStatus
  label: string
}

const DOT_STYLES: Record<AgentStatus, string> = {
  online:    'bg-malachite animate-breathe',
  thinking:  'bg-indigo animate-breathe',
  executing: 'bg-amber',
  waiting:   'bg-amber',
  offline:   'bg-smoke',
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
      {/* Dot indicator */}
      <span
        className={`inline-block w-[6px] h-[6px] rounded-full flex-shrink-0 ${DOT_STYLES[status]}`}
      />
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
