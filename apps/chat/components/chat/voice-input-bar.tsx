'use client'

// VoiceInputBar — bottom input area with bubble-float animation
// Shift+Enter for newline, IME-safe Enter to submit

import { useState, useCallback } from 'react'
import GlassInput from '@intera/shared/ui/glass-input'
import IconButton from '@intera/shared/ui/icon-button'

interface VoiceInputBarProps {
  onSubmit: (text: string) => void
  isLoading: boolean
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

export default function VoiceInputBar({
  onSubmit,
  isLoading,
}: VoiceInputBarProps) {
  const [value, setValue] = useState('')
  const [floatLevel, setFloatLevel] = useState(0)

  // Bubble float: track content length → compute float level
  const handleChange = useCallback((newValue: string) => {
    setValue(newValue)
    const level = Math.min(newValue.length / 200, 1)
    setFloatLevel(level)
  }, [])

  const handleSubmit = useCallback(() => {
    if (!value.trim() || isLoading) return
    onSubmit(value.trim())
    setValue('')
    setFloatLevel(0)
  }, [value, isLoading, onSubmit])

  const handleClear = useCallback(() => {
    setValue('')
    setFloatLevel(0)
  }, [])

  const floatY = floatLevel * 80
  const floatScale = 1 + floatLevel * 0.04

  return (
    <div className="sticky bottom-0 pb-8 pt-4" style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom, 16px))' }}>
      {/* Entire input bloc floats like a bubble */}
      <div
        className="transition-all duration-800 ease-out"
        style={{ transform: `translateY(-${floatY}px) scale(${floatScale})` }}
      >
        <div className="flex items-end gap-2">
          {/* Textarea */}
          <div className="flex-1 min-w-0">
            <GlassInput
              value={value}
              onChange={handleChange}
              placeholder="Describe your issue...  (Shift+Enter for new line)"
              disabled={isLoading}
              onSubmit={handleSubmit}
            />
          </div>

          {/* Send */}
          <IconButton
            icon={<SendIcon />}
            label="Send message"
            onClick={handleSubmit}
            variant="glass"
            size="md"
            className="flex-shrink-0 mb-0.5"
          />

          {/* Clear (only when there's content) */}
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="flex-shrink-0 mb-0.5 text-[11px] font-sans tracking-[0.04em] uppercase text-smoke hover:text-vermillion transition-colors duration-200"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
