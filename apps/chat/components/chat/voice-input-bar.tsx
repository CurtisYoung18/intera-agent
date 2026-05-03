'use client'

// VoiceInputBar — always-unlocked input with queue mode
// Shift+Enter for newline, IME-safe Enter to submit
// Messages submitted while agent is responding are queued and sent after message_stop

import { useState, useCallback } from 'react'
import GlassInput from '@intera/shared/ui/glass-input'
import IconButton from '@intera/shared/ui/icon-button'

interface VoiceInputBarProps {
  onSubmit: (text: string) => void
  queuedCount: number
  onClearQueue: () => void
  isResponding?: boolean
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
  queuedCount,
  onClearQueue,
  isResponding = false,
}: VoiceInputBarProps) {
  const [value, setValue] = useState('')

  const handleChange = useCallback((newValue: string) => {
    setValue(newValue)
  }, [])

  const handleSubmit = useCallback(() => {
    if (!value.trim()) return
    onSubmit(value.trim())
    setValue('')
  }, [value, onSubmit])

  const handleClear = useCallback(() => {
    setValue('')
    if (queuedCount > 0) onClearQueue()
  }, [queuedCount, onClearQueue])

  return (
    <div className="sticky bottom-0 pt-4 pb-6" style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom, 12px))' }}>
      {/* Queue indicator pill */}
      {queuedCount > 0 && (
        <div className="flex justify-center pb-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-sans tracking-[0.03em] text-fog/60 rounded-full bg-white/[0.03] border border-white/[0.04]">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo animate-breathe" />
            {queuedCount} {queuedCount === 1 ? 'message' : 'messages'} queued
          </span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <GlassInput
            value={value}
            onChange={handleChange}
            placeholder={isResponding ? 'Agent is responding — queue your next question...' : 'Describe your issue...  (Shift+Enter for new line)'}
            onSubmit={handleSubmit}
          />
        </div>

        <IconButton
          icon={<SendIcon />}
          label="Send message"
          onClick={handleSubmit}
          variant="glass"
          size="md"
          className="flex-shrink-0"
        />

        {(value || queuedCount > 0) && (
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
  )
}
