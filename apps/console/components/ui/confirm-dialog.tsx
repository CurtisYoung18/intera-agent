'use client'

import { AlertTriangle } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'

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

  if (!open) return null

  const confirmClass =
    variant === 'warning'
      ? 'bg-amber/[0.08] border-amber/20 text-amber hover:bg-amber/[0.15]'
      : 'bg-vermillion/10 border-vermillion/20 text-vermillion hover:bg-vermillion/15'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 backdrop-blur-sm">
      <div className="bg-white rounded-2xl border border-black/[0.06] shadow-2xl p-6 max-w-sm w-full mx-4">
        <p className="text-[14px] font-semibold text-[var(--mist)] mb-2">{title}</p>
        <p className="text-[13px] text-[var(--fog)] mb-5">{message}</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-[13px] text-[var(--fog)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] transition-all"
          >
            {cancelLabel || t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 py-2.5 rounded-xl text-[13px] font-medium border transition-all ${confirmClass}`}
          >
            {confirmLabel || t('common.delete')}
          </button>
        </div>
      </div>
    </div>
  )
}
