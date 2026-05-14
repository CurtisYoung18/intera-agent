'use client'

// GlassInput — frosted glass textarea with auto-grow

import { useRef, useCallback, useEffect, type ChangeEvent, type KeyboardEvent, type CompositionEvent } from 'react'

interface GlassInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  onSubmit?: () => void
  /** Runs before built-in Enter handling; call `preventDefault` to override. */
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  /** Outer glass shell handled by parent (e.g. unified composer capsule). */
  variant?: 'default' | 'composerInner'
  className?: string
}

export default function GlassInput({
  value,
  onChange,
  placeholder = '',
  disabled = false,
  onSubmit,
  onKeyDown,
  variant = 'default',
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
    onKeyDown?.(e)
    if (e.defaultPrevented) return
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
      className={`resize-none ${disabled ? 'opacity-40 cursor-not-allowed' : ''} ${
        variant === 'composerInner'
          ? 'glass-input-composer-field'
          : 'glass-input'
      } ${className}`}
    />
  )
}
