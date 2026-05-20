'use client'

/**
 * ExportButton — triggers a JSON file download when clicked.
 *
 * Pass `getData` (a function returning the payload) so the snapshot is
 * computed at click-time (always fresh, never stale).
 *
 * Styled to match the console glass design system.
 */

import { useState, useCallback } from 'react'
import { Download, Check } from 'lucide-react'

interface ExportButtonProps {
  /** Called at click-time to produce the JSON payload. */
  getData: () => unknown
  /** Base filename — a timestamp is appended automatically. */
  filename: string
  /** Tooltip / aria-label */
  label?: string
  /** sm | md. Defaults to sm. */
  size?: 'sm' | 'md'
}

export default function ExportButton({
  getData,
  filename,
  label = 'Export as JSON',
  size = 'sm',
}: ExportButtonProps) {
  const [done, setDone] = useState(false)

  const handleClick = useCallback(() => {
    const payload = getData()
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const ts = new Date()
      .toISOString()
      .replace('T', '_')
      .replace(/:/g, '-')
      .slice(0, 19)

    const a = document.createElement('a')
    a.href = url
    a.download = `${filename}-${ts}.json`
    a.click()
    URL.revokeObjectURL(url)

    setDone(true)
    setTimeout(() => setDone(false), 1800)
  }, [getData, filename])

  const dim = size === 'md' ? 'h-9 w-9' : 'h-8 w-8'
  const icon = size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'

  return (
    <button
      type="button"
      onClick={handleClick}
      title={label}
      aria-label={label}
      className={`${dim} flex shrink-0 items-center justify-center rounded-xl border transition-all duration-200
        ${done
          ? 'border-emerald/30 bg-emerald/[0.08] text-emerald'
          : 'border-black/[0.07] bg-white/50 text-[var(--fog)] hover:border-black/10 hover:bg-white/80 hover:text-[var(--mist)]'
        }
        shadow-[var(--shadow-input)] backdrop-blur-md
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo/25`}
    >
      {done
        ? <Check className={`${icon} shrink-0`} strokeWidth={2.5} />
        : <Download className={`${icon} shrink-0`} strokeWidth={1.75} />
      }
    </button>
  )
}
