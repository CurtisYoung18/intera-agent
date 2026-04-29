'use client'

// VoiceInputBar — bottom input area with bubble-float animation
// Shift+Enter for newline, IME-safe Enter to submit
// Shows loading animation when agent is processing

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
      <div
        className="transition-all duration-800 ease-out"
        style={{ transform: `translateY(-${floatY}px) scale(${floatScale})` }}
      >
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0 relative">
            {/* Loading pill INSIDE input area — replaces placeholder when agent is responding */}
            {isLoading ? (
              <div className="glass-input flex items-center gap-2 pointer-events-none animate-fade-up">
                <svg width="20" height="6" viewBox="0 0 20 6" fill="rgba(140,138,133,0.5)" aria-hidden="true" className="flex-shrink-0">
                  {[0, 1, 2].map((i) => (
                    <circle key={i} cx={3 + i * 7} cy="3" r={i === 1 ? 1.5 : 3} fillOpacity={i === 1 ? 0.3 : 1}>
                      <animate attributeName="r" values={i === 1 ? '1.5;3;1.5' : '3;1.5;3'} calcMode="linear" begin="0s" dur="0.8s" repeatCount="indefinite" />
                      <animate attributeName="fill-opacity" values={i === 1 ? '0.3;1;0.3' : '1;0.3;1'} calcMode="linear" begin="0s" dur="0.8s" repeatCount="indefinite" />
                    </circle>
                  ))}
                </svg>
                <span className="text-[13px] font-serif italic text-fog/50 animate-shimmer-text select-none">Intera is responding…</span>
              </div>
            ) : (
              <GlassInput
                value={value}
                onChange={handleChange}
                placeholder="Describe your issue...  (Shift+Enter for new line)"
                disabled={isLoading}
                onSubmit={handleSubmit}
              />
            )}
          </div>

          <IconButton
            icon={<SendIcon />}
            label="Send message"
            onClick={handleSubmit}
            variant="glass"
            size="md"
            className="flex-shrink-0 mb-0.5"
          />

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
