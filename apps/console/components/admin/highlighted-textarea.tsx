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
 * Textarea with a coloured backdrop layer for {{placeholder}} tokens.
 *
 * Cursor-alignment fix
 * --------------------
 * Browsers render text metrics differently in <div> vs <textarea> with the
 * same font-family, causing the backdrop text and the transparent textarea
 * text to drift apart — the caret then appears mid-word.
 *
 * Fix: use `system-ui` (most consistent cross-element), explicit
 * `box-sizing: border-box` on both layers, and identical computed styles
 * (padding, border-width, line-height) so both layers occupy the same
 * pixel rectangle before antialiasing.
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

  /**
   * Typography tokens shared verbatim by both layers.
   * Using system-ui instead of a monospace stack:
   *   - prose prompts are more readable in a proportional font
   *   - system-ui renders identically in <div> and <textarea> in all
   *     major browsers (the monospace stack can differ by 0.5–1 px)
   */
  const typography: React.CSSProperties = {
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: '13.5px',
    lineHeight: '1.75',
    letterSpacing: '0px',         // explicit 0 prevents browser kerning drift
    fontKerning: 'none',          // ditto for kerning tables
    fontFeatureSettings: '"kern" 0, "liga" 0', // disable ligatures in both
    wordBreak: 'break-word' as const,
    overflowWrap: 'break-word' as const,
    whiteSpace: 'pre-wrap' as const,
    boxSizing: 'border-box' as const,
  }

  // Shared box model — must be identical byte-for-byte on both layers.
  const PAD = '0.75rem 1rem'
  const BORDER = '1.5px'
  const RADIUS = '0.875rem'

  return (
    <div className={className} style={{ position: 'relative', boxSizing: 'border-box' }}>
      {/* ── Backdrop: renders coloured placeholder spans ── */}
      <div
        ref={backdropRef}
        aria-hidden="true"
        style={{
          ...typography,
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          padding: PAD,
          border: `${BORDER} solid transparent`,
          borderRadius: RADIUS,
          background: 'var(--console-surface, #ffffff)',
          color: 'var(--mist, #1a1a2e)',
          overflow: 'hidden',
          pointerEvents: 'none',
          // Subpixel: match textarea rendering hints
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
        } as React.CSSProperties}
      >
        {segments.map((seg, i) =>
          seg.color ? (
            <mark
              key={i}
              style={{
                background: `${seg.color}22`,
                color: seg.color,
                fontWeight: 700,
                borderRadius: 3,
                padding: '0 1px',
              }}
            >
              {seg.text}
            </mark>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
        {/* Ensure backdrop height matches when text ends in newline */}
        {value.endsWith('\n') && ' '}
      </div>

      {/* ── Textarea: handles all input; transparent so backdrop shows ── */}
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
          minHeight: 'min(400px, 50vh)',
          resize: 'vertical',
          padding: PAD,
          border: `${BORDER} solid rgba(0,0,0,0.12)`,
          borderRadius: RADIUS,
          // Transparent text + visible caret — the backdrop shows through
          background: 'transparent',
          color: 'transparent',
          caretColor: 'var(--mist, #1a1a2e)',
          WebkitTextFillColor: 'transparent',
          // Prevent any browser-specific textarea chrome from shifting layout
          WebkitAppearance: 'none',
          appearance: 'none',
          outline: 'none',
          margin: 0,
          // Match backdrop rendering hints
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
        } as React.CSSProperties}
      />
    </div>
  )
}
