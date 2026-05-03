// Empty state — friendly placeholder when lists are empty

import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: { label: string; onClick: () => void }
}

export default function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="glass-card p-10 text-center max-w-md mx-auto">
      <Icon className="w-10 h-10 mx-auto mb-4 text-fog/20" strokeWidth={1.5} />
      <h3 className="text-[15px] font-medium text-primary mb-1">{title}</h3>
      <p className="text-[13px] text-secondary leading-relaxed mb-4">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 rounded-lg text-[13px] font-medium bg-indigo/15 border border-indigo/25 text-indigo hover:bg-indigo/25 transition-all duration-200"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

// Helpers for CSS variable text colors
const style = { '--tw-text-primary': 'var(--text-primary)', '--tw-text-secondary': 'var(--text-secondary)' } as React.CSSProperties
