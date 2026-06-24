import type { HTMLAttributes, ReactNode } from 'react'
import { ArrowLeft, type LucideIcon } from 'lucide-react'

/** Maps API case statuses to preset visual tones for `.console-status-pill[data-tone]`. */
export function consoleCaseStatusTone(status: string): 'resolved' | 'waiting' | 'escalated' | 'progress' | 'neutral' {
  switch (status) {
    case 'resolved':
      return 'resolved'
    case 'waiting_human':
      return 'waiting'
    case 'escalated':
      return 'waiting'
    case 'collecting':
    case 'investigating':
    case 'verifying':
      return 'progress'
    case 'created':
    default:
      return 'neutral'
  }
}

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

type ConsoleSurfaceTag = 'div' | 'section' | 'header' | 'article' | 'aside'
type ConsoleSurfaceTone = 'panel' | 'muted' | 'toolbar' | 'floating'
type ConsoleSurfacePadding = 'none' | 'sm' | 'md' | 'lg'
type ConsoleStatusTone = ReturnType<typeof consoleCaseStatusTone>

interface ConsoleSurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: ConsoleSurfaceTag
  tone?: ConsoleSurfaceTone
  padding?: ConsoleSurfacePadding
  glow?: boolean
  interactive?: boolean
}

/**
 * Shared UI2-A material wrapper.
 * Use it for shell chrome, drawers, empty states, and reusable page containers.
 */
export function ConsoleSurface({
  as = 'div',
  tone = 'panel',
  padding = 'md',
  glow = false,
  interactive = false,
  className,
  children,
  ...props
}: ConsoleSurfaceProps) {
  const Tag = as
  return (
    <Tag
      className={joinClasses('console-surface', glow && 'glass-card-glow', className)}
      data-tone={tone}
      data-padding={padding}
      data-interactive={interactive || undefined}
      {...props}
    >
      {children}
    </Tag>
  )
}

/** Shared toolbar/action rail wrapper for page-level controls and status rows. */
export function ConsoleToolbarSurface({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <ConsoleSurface
      tone="toolbar"
      padding="sm"
      className={joinClasses('console-toolbar-surface', className)}
      {...props}
    >
      {children}
    </ConsoleSurface>
  )
}

/**
 * Route-level header wrapper for UI2-B/C pages.
 * Pair with `ConsoleToolbarSurface` for action rows directly below the header.
 */
export function ConsolePageHeader({
  eyebrow,
  title,
  description,
  status,
  actions,
  children,
  className,
}: {
  eyebrow?: string
  title: string
  description?: string
  status?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <ConsoleSurface as="header" padding="lg" className={joinClasses('console-page-header', className)}>
      <div className="console-page-header-copy">
        {eyebrow ? <p className="console-page-header-eyebrow">{eyebrow}</p> : null}
        <div className="console-page-header-title-row">
          <h1 className="console-page-header-title">{title}</h1>
          {status ? <div className="console-page-header-status">{status}</div> : null}
        </div>
        {description ? <p className="console-page-header-description">{description}</p> : null}
        {children}
      </div>
      {actions ? <div className="console-page-header-actions">{actions}</div> : null}
    </ConsoleSurface>
  )
}

export function ConsoleBackButton({
  label,
  ariaLabel,
  onClick,
  className,
}: {
  label: string
  ariaLabel: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={joinClasses('console-btn-back', className)}
      aria-label={ariaLabel}
    >
      <ArrowLeft className="h-4 w-4 flex-shrink-0 opacity-85" aria-hidden />
      <span>{label}</span>
    </button>
  )
}

export function ConsoleToolbarButton({
  icon: Icon,
  children,
  onClick,
  className,
  tone = 'default',
}: {
  icon: LucideIcon
  children: ReactNode
  onClick: () => void
  className?: string
  tone?: 'default' | 'accent' | 'danger'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={joinClasses('console-btn-toolbar', className)}
      data-tone={tone}
    >
      <Icon className="h-3.5 w-3.5 flex-shrink-0 opacity-[0.92]" aria-hidden />
      <span>{children}</span>
    </button>
  )
}

export function ConsoleStatusPill({
  status,
  tone,
  children,
  className,
}: {
  status?: string
  tone?: ConsoleStatusTone
  children: ReactNode
  className?: string
}) {
  const resolvedTone = tone ?? consoleCaseStatusTone(status ?? 'created')
  return (
    <span className={joinClasses('console-status-pill', className)} data-tone={resolvedTone}>
      {children}
    </span>
  )
}
