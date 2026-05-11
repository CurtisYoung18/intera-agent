// Empty state — friendly placeholder when lists are empty

import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: { label: string; onClick: () => void }
  /** Larger card + typography — use on sparse pages that should feel centered / spacious */
  size?: 'default' | 'large'
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = 'default',
}: EmptyStateProps) {
  const large = size === 'large'

  return (
    <div
      className={
        large
          ? 'glass-card mx-auto w-full max-w-xl px-10 py-12 sm:px-14 sm:py-14 text-center shadow-[0_18px_50px_-24px_rgba(0,0,0,0.18)]'
          : 'glass-card p-10 text-center max-w-md mx-auto'
      }
    >
      <Icon
        className={
          large
            ? 'w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-6 text-fog/25'
            : 'w-10 h-10 mx-auto mb-4 text-fog/20'
        }
        strokeWidth={1.5}
      />
      <h3
        className={
          large
            ? 'text-[18px] sm:text-[20px] font-semibold text-primary mb-2 tracking-[-0.02em]'
            : 'text-[15px] font-medium text-primary mb-1'
        }
      >
        {title}
      </h3>
      <p
        className={
          large
            ? 'text-[14px] sm:text-[15px] text-secondary leading-relaxed mb-4 max-w-md mx-auto'
            : 'text-[13px] text-secondary leading-relaxed mb-4'
        }
      >
        {description}
      </p>
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
