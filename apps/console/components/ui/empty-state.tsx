// Empty state — friendly placeholder when lists are empty

import type { LucideIcon } from 'lucide-react'
import { ConsoleSurface } from '@/components/ui/console-chrome'

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
    <ConsoleSurface
      padding={large ? 'lg' : 'md'}
      className={
        large
          ? 'console-empty-state mx-auto w-full max-w-xl px-10 py-12 sm:px-14 sm:py-14 shadow-[0_18px_50px_-24px_rgba(21,23,25,0.18)]'
          : 'console-empty-state mx-auto max-w-md p-10'
      }
    >
      <div className={`console-empty-state-icon ${large ? 'h-20 w-20 rounded-[22px]' : 'h-14 w-14'}`}>
        <Icon
          className={large ? 'h-9 w-9 text-[var(--color-text-tertiary)]/55' : 'h-6 w-6 text-[var(--color-text-tertiary)]/45'}
          strokeWidth={1.5}
        />
      </div>
      <h3
        className={
          large
            ? 'mb-2 text-[18px] font-semibold tracking-[-0.02em] text-[var(--color-text-primary)] sm:text-[20px]'
            : 'mb-1 text-[15px] font-medium text-[var(--color-text-primary)]'
        }
      >
        {title}
      </h3>
      <p
        className={
          large
            ? 'mx-auto mb-4 max-w-md text-[14px] leading-relaxed text-[var(--color-text-secondary)] sm:text-[15px]'
            : 'mb-4 text-[13px] leading-relaxed text-[var(--color-text-secondary)]'
        }
      >
        {description}
      </p>
      {action && (
        <button
          onClick={action.onClick}
          className="rounded-[14px] border border-[rgba(53,127,124,0.16)] bg-[rgba(53,127,124,0.08)] px-4 py-2 text-[13px] font-semibold text-[var(--color-accent-primary)] shadow-[0_8px_18px_rgba(21,23,25,0.04)] transition-all duration-200 hover:bg-[rgba(53,127,124,0.14)]"
        >
          {action.label}
        </button>
      )}
    </ConsoleSurface>
  )
}
