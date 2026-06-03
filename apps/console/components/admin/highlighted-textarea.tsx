'use client'

interface Props {
  id?: string
  value: string
  onChange: (value: string) => void
  className?: string
  spellCheck?: boolean
  /** @deprecated Highlights prop kept for backward compat; count bar removed (U3) */
  highlights?: Array<{ pattern: RegExp; color: string }>
}

/**
 * Plain textarea component.
 * The count bar ("N placeholders") was removed in U3 — redundant with
 * the named placeholder pill rows in each prompt section.
 */
export default function HighlightedTextarea({
  id,
  value,
  onChange,
  className,
  spellCheck,
}: Props) {
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
    </div>
  )
}
