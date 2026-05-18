'use client'

import { useRef, useCallback } from 'react'

interface Props {
  id?: string
  value: string
  onChange: (value: string) => void
  className?: string
  spellCheck?: boolean
  highlights?: Array<{ pattern: RegExp; color: string }>
}

function highlightTokens(
  text: string,
  highlights: Props['highlights'],
): Array<{ text: string; color?: string }> {
  if (!highlights?.length) return [{ text }]

  const patterns = highlights.map((h) => `(${h.pattern.source})`)
  const combined = new RegExp(patterns.join('|'), 'g')

  const segments: Array<{ text: string; color?: string }> = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = combined.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index) })
    }
    for (let i = 0; i < highlights.length; i++) {
      if (match[i + 1] !== undefined) {
        segments.push({ text: match[0], color: highlights[i].color })
        break
      }
    }
    lastIndex = combined.lastIndex
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) })
  }

  return segments
}

/**
 * Textarea with syntax-highlighted backdrop for placeholders.
 * Uses a transparent textarea stacked above a styled div so the caret,
 * selection, and resize handle remain native while placeholder tokens
 * render in colour on the backdrop layer.
 */
export default function HighlightedTextarea({
  id,
  value,
  onChange,
  className,
  spellCheck,
  highlights,
}: Props) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const syncScroll = useCallback(() => {
    if (backdropRef.current && textareaRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }, [])

  const segments = highlightTokens(value, highlights)

  // Shared typography so text layers align pixel-perfectly.
  const typography = {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '13px',
    lineHeight: '1.625',
    whiteSpace: 'pre-wrap' as const,
    overflowWrap: 'break-word' as const,
    wordBreak: 'break-word' as const,
  }

  return (
    <div className={className} style={{ position: 'relative' }}>
      {/* Backdrop — renders coloured placeholder tokens behind the textarea */}
      <div
        ref={backdropRef}
        aria-hidden="true"
        style={{
          ...typography,
          position: 'absolute',
          inset: 0,
          padding: '0.75rem 0.875rem',
          overflow: 'hidden',
          pointerEvents: 'none',
          color: '#1a1a2e',
          background: '#fff',
          borderRadius: '0.75rem',
          border: '1px solid transparent',
        }}
      >
        {segments.map((seg, i) =>
          seg.color ? (
            <span key={i} style={{ color: seg.color, fontWeight: 600 }}>
              {seg.text}
            </span>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
        {value.endsWith('\n') && '\n'}
      </div>

      {/* Transparent textarea — handles all input, caret, selection, resize */}
      <textarea
        ref={textareaRef}
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        spellCheck={spellCheck ?? false}
        style={{
          ...typography,
          position: 'relative',
          display: 'block',
          width: '100%',
          minHeight: 'min(340px, 40vh)',
          resize: 'vertical',
          padding: '0.75rem 0.875rem',
          background: 'transparent',
          color: 'transparent',
          caretColor: '#1a1a2e',
          border: '1px solid #e2e2e8',
          borderRadius: '0.75rem',
          outline: 'none',
          WebkitTextFillColor: 'transparent',
          margin: 0,
        }}
      />
    </div>
  )
}
