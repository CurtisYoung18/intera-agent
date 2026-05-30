'use client'

interface Props {
  id?: string
  value: string
  onChange: (value: string) => void
  className?: string
  spellCheck?: boolean
  highlights?: Array<{ pattern: RegExp; color: string }>
}

function countHighlights(
  text: string,
  highlights: Props['highlights'],
): Record<string, number> {
  if (!highlights?.length) return {}
  const counts: Record<string, number> = {}
  for (const h of highlights) {
    const matches = text.match(h.pattern)
    counts[h.color] = matches ? matches.length : 0
  }
  return counts
}

/**
 * Plain textarea with a placeholder-usage indicator bar below.
 * The previous overlay-backdrop approach (transparent textarea on top of a
 * coloured <div>) had an unfixable cursor-drift bug: <textarea> and <div>
 * use different text layout engines, so characters never align pixel-perfectly
 * regardless of font/kerning tweaks.
 */
export default function HighlightedTextarea({
  id,
  value,
  onChange,
  className,
  spellCheck,
  highlights,
}: Props) {
  const hlCounts = highlights ? countHighlights(value, highlights) : {}

  return (
    <div className={className}>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={spellCheck ?? false}
        className="w-full min-h-[min(400px,50vh)] resize-y px-4 py-3 text-[13px] leading-relaxed font-mono border border-black/[0.12] rounded-xl bg-white outline-none focus:border-indigo/30"
        style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' }}
      />
      {highlights?.length ? (
        <div className="flex items-center gap-3 mt-1.5 px-1 text-[10px] text-[var(--fog)]/60">
          {highlights.map((h) => (
            <span key={h.color} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: h.color }} />
              <span>{(hlCounts[h.color] ?? 0)} placeholders</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
