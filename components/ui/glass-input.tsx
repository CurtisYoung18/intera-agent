'use client'

// GlassInput — frosted glass text input

import type { ChangeEvent, KeyboardEvent } from 'react'

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
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && onSubmit) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <input
      type="text"
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      className={`glass-input ${disabled ? 'opacity-40 cursor-not-allowed' : ''} ${className}`}
    />
  )
}
