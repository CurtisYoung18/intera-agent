'use client'

// GlassInput — frosted glass textarea with auto-grow

import { useRef, useCallback, useEffect, type ChangeEvent, type KeyboardEvent, type CompositionEvent } from 'react'

interface GlassInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  onSubmit?: () => void
  className?: string
}

export default function GlassInput({
  value,
  onChange,
  placeholder = '',
  disabled = false,
  onSubmit,
  className = '',
}: GlassInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)

  // Auto-resize textarea to fit content
  const resize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useEffect(() => {
    resize()
  }, [value, resize])

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter → newline (default behavior, don't prevent)
    if (e.key === 'Enter' && e.shiftKey) {
      return
    }
    // Enter alone → submit (but NOT during IME composition)
    if (e.key === 'Enter' && !e.shiftKey && onSubmit && !composingRef.current) {
      e.preventDefault()
      onSubmit()
    }
  }

  const handleCompositionStart = (_e: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = true
  }

  const handleCompositionEnd = (_e: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false
  }

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      placeholder={placeholder}
      disabled={disabled}
      rows={1}
      className={`glass-input resize-none ${disabled ? 'opacity-40 cursor-not-allowed' : ''} ${className}`}
    />
  )
}
