'use client'

import { useId } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'
import { ConsoleSurface } from '@/components/ui/console-chrome'

interface Props {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning'
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'danger',
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useConsoleLocale()
  const titleId = useId()
  const descriptionId = useId()

  if (!open) return null

  const confirmClass =
    variant === 'warning'
      ? 'border-[rgba(213,150,61,0.2)] bg-[rgba(213,150,61,0.08)] text-[var(--color-signal-warning)] hover:bg-[rgba(213,150,61,0.14)]'
      : 'border-[rgba(201,99,91,0.2)] bg-[rgba(201,99,91,0.08)] text-[var(--color-signal-danger)] hover:bg-[rgba(201,99,91,0.14)]'

  return (
    <div className="console-overlay z-[60] flex items-center justify-center px-4">
      <ConsoleSurface
        tone="floating"
        padding="lg"
        className="w-full max-w-sm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[16px] border border-white/80 bg-white/[0.82] shadow-[0_8px_18px_rgba(21,23,25,0.05),inset_0_1px_0_rgba(255,255,255,0.76)]">
            <AlertTriangle
              className={`h-4 w-4 ${variant === 'warning' ? 'text-[var(--color-signal-warning)]' : 'text-[var(--color-signal-danger)]'}`}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p id={titleId} className="text-[15px] font-semibold text-[var(--color-text-primary)]">{title}</p>
            <p id={descriptionId} className="mt-1 text-[13px] leading-6 text-[var(--color-text-secondary)]">{message}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-[14px] border border-white/75 bg-white/[0.74] px-4 py-2.5 text-[13px] font-medium text-[var(--color-text-secondary)] shadow-[0_8px_18px_rgba(21,23,25,0.04),inset_0_1px_0_rgba(255,255,255,0.64)] transition-all hover:border-[rgba(53,127,124,0.16)] hover:bg-white hover:text-[var(--color-text-primary)]"
          >
            {cancelLabel || t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 rounded-[14px] px-4 py-2.5 text-[13px] font-semibold shadow-[0_10px_18px_rgba(21,23,25,0.05)] transition-all ${confirmClass}`}
          >
            {confirmLabel || t('common.delete')}
          </button>
        </div>
      </ConsoleSurface>
    </div>
  )
}
