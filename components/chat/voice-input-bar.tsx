'use client'

// VoiceInputBar — bottom input area with timer and save/cancel buttons

import { useState, useEffect, useCallback } from 'react'
import GlassInput from '@/components/ui/glass-input'
import IconButton from '@/components/ui/icon-button'

interface VoiceInputBarProps {
  onSubmit: (text: string) => void
  isLoading: boolean
  caseDuration: number
  onSaveMemory?: () => void
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

// Inline SVG icons — no external dependency
function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  )
}

function SaveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
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
  caseDuration,
  onSaveMemory,
}: VoiceInputBarProps) {
  const [value, setValue] = useState('')
  const [displayTime, setDisplayTime] = useState(caseDuration)

  useEffect(() => {
    setDisplayTime(caseDuration)
  }, [caseDuration])

  useEffect(() => {
    const interval = setInterval(() => {
      setDisplayTime((t) => t + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const handleSubmit = useCallback(() => {
    if (!value.trim() || isLoading) return
    onSubmit(value.trim())
    setValue('')
  }, [value, isLoading, onSubmit])

  const handleClear = useCallback(() => {
    setValue('')
  }, [])

  return (
    <div className="sticky bottom-0 pb-8 pt-4" style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom, 16px))' }}>
      {/* Input row */}
      <div className="flex items-center gap-2">
        {/* Mic icon — desktop only */}
        <span className="text-smoke hidden sm:block flex-shrink-0">
          <MicIcon />
        </span>

        {/* Text field */}
        <div className="flex-1 min-w-0">
          <GlassInput
            value={value}
            onChange={setValue}
            placeholder="Describe your issue..."
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
          className="flex-shrink-0"
        />
      </div>

      {/* Controls row: timer · save · clear */}
      <div className="flex items-center justify-center gap-4 mt-3 pb-1">
        <span className="text-[13px] font-mono text-smoke tabular-nums select-none">
          {formatDuration(displayTime)}
        </span>

        {onSaveMemory && (
          <button
            type="button"
            onClick={onSaveMemory}
            className="inline-flex items-center gap-1.5 text-[11px] font-sans tracking-[0.04em] uppercase text-smoke hover:text-mist transition-colors duration-200"
          >
            <SaveIcon />
            <span className="hidden sm:inline">Save Memory</span>
            <span className="sm:hidden">Save</span>
          </button>
        )}

        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-1 text-[11px] font-sans tracking-[0.04em] uppercase text-smoke hover:text-vermillion transition-colors duration-200"
          >
            <CloseIcon />
            <span className="hidden sm:inline">Clear</span>
          </button>
        )}
      </div>
    </div>
  )
}
