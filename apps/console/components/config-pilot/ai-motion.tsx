'use client'

export type OrganicLoaderVariant = '01' | '02' | '05' | '06' | '10' | '11' | '12' | '17' | '20'

interface OrganicLoaderProps {
  variant?: OrganicLoaderVariant
  size?: number
  className?: string
  title?: string
}

const APPROVED_VARIANTS: OrganicLoaderVariant[] = ['01', '02', '05', '06', '10', '11', '12', '17', '20']

export function OrganicLoader({ variant = '12', size = 24, className = '', title }: OrganicLoaderProps) {
  return (
    <svg
      data-variant={variant}
      className={`intera-organic-loader ${className}`}
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      <OrganicLoaderGlyph variant={variant} />
    </svg>
  )
}

export function OrganicLoaderStrip({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`} aria-hidden="true">
      {APPROVED_VARIANTS.map((variant) => (
        <span key={variant} className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/70">
          <OrganicLoader variant={variant} size={18} />
        </span>
      ))}
    </div>
  )
}

export function TokenStreamPreview({ text, className = '' }: { text: string; className?: string }) {
  const chunks = chunkText(text)
  return (
    <span className={`intera-token-stream ${className}`}>
      {chunks.map((chunk, index) => (
        <span
          key={`${chunk}-${index}`}
          className="tok"
          style={{ animationDelay: `${index * 80}ms` }}
        >
          {chunk}
        </span>
      ))}
      <span className="caret" aria-hidden="true" />
    </span>
  )
}

function OrganicLoaderGlyph({ variant }: { variant: OrganicLoaderVariant }) {
  if (variant === '01') {
    return (
      <g>
        <circle className="ink a" r="10" />
        <circle className="ink b" r="10" />
      </g>
    )
  }

  if (variant === '02') {
    return (
      <g className="ring origin">
        <circle className="ink" cx="32" cy="13" r="7" />
        <circle className="ink" cx="48" cy="41" r="7" />
        <circle className="ink" cx="16" cy="41" r="7" />
      </g>
    )
  }

  if (variant === '05') {
    return (
      <g className="splat origin">
        <circle className="ink" cx="32" cy="32" r="13" />
        <circle className="ink" cx="18" cy="25" r="5" />
        <circle className="ink" cx="48" cy="28" r="4.5" />
        <circle className="ink" cx="23" cy="48" r="5" />
        <circle className="ink" cx="45" cy="46" r="5.5" />
        <circle className="ink" cx="32" cy="16" r="4" />
      </g>
    )
  }

  if (variant === '06') {
    return (
      <g className="ring origin">
        <circle className="ink" cx="32" cy="12" r="5.5" />
        <circle className="ink" cx="32" cy="12" r="5" opacity="0.74" transform="rotate(26 32 32)" />
        <circle className="ink" cx="32" cy="12" r="4.5" opacity="0.55" transform="rotate(52 32 32)" />
        <circle className="ink" cx="32" cy="12" r="4" opacity="0.38" transform="rotate(78 32 32)" />
        <circle className="ink" cx="32" cy="12" r="3.5" opacity="0.25" transform="rotate(104 32 32)" />
      </g>
    )
  }

  if (variant === '10') {
    return (
      <g className="jelly origin">
        <path className="ink" d="M32 14C44 14 51 23 50 33C49 45 42 51 31 50C20 49 13 42 14 31C15 21 21 14 32 14Z" />
      </g>
    )
  }

  if (variant === '11') {
    return (
      <g className="petals origin">
        <circle className="ink" cx="32" cy="32" r="7" />
        <circle className="ink" cx="32" cy="15" r="5.5" />
        <circle className="ink" cx="32" cy="49" r="5.5" />
        <circle className="ink" cx="15" cy="32" r="5.5" />
        <circle className="ink" cx="49" cy="32" r="5.5" />
      </g>
    )
  }

  if (variant === '12') {
    return (
      <g>
        <circle className="stroke r1 origin" cx="32" cy="32" r="22" strokeWidth="5" />
        <circle className="stroke r2 origin" cx="32" cy="32" r="22" strokeWidth="5" opacity="0.58" />
        <circle className="stroke r3 origin" cx="32" cy="32" r="22" strokeWidth="5" opacity="0.34" />
        <circle className="ink" cx="32" cy="32" r="4" />
      </g>
    )
  }

  if (variant === '17') {
    return (
      <g>
        <circle className="ink c1 origin" cx="22" cy="22" r="8" />
        <circle className="ink c2 origin" cx="42" cy="22" r="8" />
        <circle className="ink c3 origin" cx="22" cy="42" r="8" />
        <circle className="ink c4 origin" cx="42" cy="42" r="8" />
      </g>
    )
  }

  return (
    <g>
      <circle className="ink d1 origin" cx="32" cy="12" r="4" />
      <circle className="ink d2 origin" cx="46" cy="18" r="4" />
      <circle className="ink d3 origin" cx="52" cy="32" r="4" />
      <circle className="ink d4 origin" cx="46" cy="46" r="4" />
      <circle className="ink d5 origin" cx="32" cy="52" r="4" />
      <circle className="ink d6 origin" cx="18" cy="46" r="4" />
      <circle className="ink d7 origin" cx="12" cy="32" r="4" />
      <circle className="ink d8 origin" cx="18" cy="18" r="4" />
    </g>
  )
}

function chunkText(text: string) {
  const chunks: string[] = []
  let index = 0
  const sizes = [3, 4, 2, 5, 3, 4]
  while (index < text.length) {
    const size = sizes[chunks.length % sizes.length]
    chunks.push(text.slice(index, index + size))
    index += size
  }
  return chunks
}
