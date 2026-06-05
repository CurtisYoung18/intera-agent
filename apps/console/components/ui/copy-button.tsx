'use client'
import { useState, useCallback } from 'react'
import { Copy, Check } from 'lucide-react'

export default function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [text])
  return (
    <button onClick={handleCopy} aria-label={label || 'Copy'} title={label || 'Copy'}
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--fog)' }}>
      {copied ? <><Check size={12} /> Copied</> : <Copy size={12} />}
    </button>
  )
}
