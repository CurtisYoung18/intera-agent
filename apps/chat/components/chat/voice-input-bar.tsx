'use client'

// VoiceInputBar — always-unlocked input with queue mode
// Shift+Enter for newline, IME-safe Enter to submit
// Optional DeepSeek-prefix composer hints (Tab to append) when Console enables assist

import { useState, useCallback, useEffect, useRef } from 'react'
import GlassInput from '@intera/shared/ui/glass-input'
import type { KeyboardEvent as ReactKb } from 'react'

interface VoiceInputBarProps {
  onSubmit: (text: string) => void
  queuedCount: number
  onClearQueue: () => void
  isResponding?: boolean
  /**
   * Off when case is split to the left — user can send in parallel with /api/messages
   * and we do not show queue-style copy.
   */
  allowQueueWhileBusy?: boolean
  /** When true, server offers draft continuations for the composer only */
  composerAssistEnabled?: boolean
  customerId?: string
  /** Console switch on — show env hint when Chat lacks DEEPSEEK_API_KEY */
  assistMissingDeepseekKey?: boolean
  /** From Console / feature API (aligned with server-side suggest) */
  composerMinDraftChars?: number
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      <path
        d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-9z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function VoiceInputBar({
  onSubmit,
  queuedCount,
  onClearQueue,
  isResponding = false,
  allowQueueWhileBusy = true,
  composerAssistEnabled = false,
  customerId = 'default',
  assistMissingDeepseekKey = false,
  composerMinDraftChars = 4,
}: VoiceInputBarProps) {
  const [value, setValue] = useState('')
  const [suggestion, setSuggestion] = useState('')
  const [assistLoading, setAssistLoading] = useState(false)
  const suggestionAbortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    suggestionAbortRef.current?.abort()

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }

    if (!composerAssistEnabled) {
      setSuggestion('')
      setAssistLoading(false)
      return
    }

    const trimmedLen = value.trim().length
    if (trimmedLen < composerMinDraftChars) {
      setSuggestion('')
      setAssistLoading(false)
      return
    }

    const ac = new AbortController()
    suggestionAbortRef.current = ac

    debounceRef.current = setTimeout(async () => {
      setAssistLoading(true)
      try {
        const res = await fetch('/api/composer-assist/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ draft: value, customerId }),
          signal: ac.signal,
        })
        if (!res.ok || ac.signal.aborted) {
          if (!ac.signal.aborted) setSuggestion('')
          return
        }
        const data = (await res.json()) as { continuation?: string }
        const c = typeof data.continuation === 'string' ? data.continuation : ''
        if (!ac.signal.aborted) setSuggestion(c)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setSuggestion('')
        }
      } finally {
        if (!ac.signal.aborted) setAssistLoading(false)
      }
    }, 520)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      ac.abort()
    }
  }, [value, composerAssistEnabled, customerId, composerMinDraftChars])

  const handleChange = useCallback((newValue: string) => {
    setValue(newValue)
  }, [])

  const handleSubmit = useCallback(() => {
    if (!value.trim()) return
    setSuggestion('')
    onSubmit(value.trim())
    setValue('')
  }, [value, onSubmit])

  const canSend = value.trim().length > 0

  const handleClear = useCallback(() => {
    setValue('')
    setSuggestion('')
    if (queuedCount > 0) onClearQueue()
  }, [queuedCount, onClearQueue])

  const handleComposerKeyDown = useCallback(
    (e: ReactKb<HTMLTextAreaElement>) => {
      if (!suggestion || e.key !== 'Tab' || e.shiftKey) return
      e.preventDefault()
      const next = `${value}${suggestion}`
      setValue(next)
      setSuggestion('')
    },
    [value, suggestion],
  )

  const handleEscapeSuggestions = useCallback((e: ReactKb<HTMLTextAreaElement>) => {
    if (e.key !== 'Escape' || !suggestion) return
    e.preventDefault()
    setSuggestion('')
  }, [suggestion])

  const composerKeyDownChain = useCallback(
    (e: ReactKb<HTMLTextAreaElement>) => {
      handleEscapeSuggestions(e)
      handleComposerKeyDown(e)
    },
    [handleEscapeSuggestions, handleComposerKeyDown],
  )

  return (
    <div className="sticky bottom-0 pt-4 pb-6" style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom, 12px))' }}>
      {assistMissingDeepseekKey && (
        <div
          role="status"
          className="mx-auto mb-2 max-w-[min(600px,100%)] rounded-xl border border-vermillion/20 bg-vermillion/[0.06] px-3 py-2 text-[11px] font-sans leading-snug text-mist/[0.85]"
        >
          控制台已打开「输入续写」，但 Chat 服务端未检测到 <code className="font-mono text-[10px]">DEEPSEEK_API_KEY</code>
          （需写在仓库根的 <code className="font-mono text-[10px]">.env.local</code> ，并重启 Chat）。
        </div>
      )}

      {/* Queue indicator pill */}
      {allowQueueWhileBusy && queuedCount > 0 && (
        <div className="flex justify-center pb-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-sans tracking-[0.03em] text-fog/60 rounded-full bg-[var(--surface)] border border-[var(--border-subtle)]">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo animate-breathe" />
            {queuedCount} {queuedCount === 1 ? 'message' : 'messages'} queued
          </span>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="glass-input-composer min-w-0 flex-1">
          <GlassInput
            variant="composerInner"
            value={value}
            onChange={handleChange}
            placeholder={(() => {
              if (!isResponding) return 'Describe your issue... (Shift+Enter for new line)'
              if (!allowQueueWhileBusy) {
                const zh =
                  typeof navigator !== 'undefined' &&
                  navigator.language.toLowerCase().startsWith('zh')
                return zh ? '可随时发言；左侧为工单调查进度' : 'Keep typing — investigation runs in the left rail'
              }
              return 'Agent is responding — queue your next question...'
            })()}
            onSubmit={handleSubmit}
            onKeyDown={composerKeyDownChain}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSend}
            aria-label="Send message"
            title="Send"
            className="group/send mb-px flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo/[0.14] text-indigo/[0.92] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] outline-none ring-1 ring-black/[0.04] transition-[transform,opacity,background-color,box-shadow] duration-150 hover:enabled:bg-indigo/[0.22] hover:enabled:text-indigo active:enabled:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-[0.28] focus-visible:ring-2 focus-visible:ring-indigo/35"
          >
            <SendIcon className="translate-x-[0.5px] transition-transform duration-150 group-hover/send:translate-x-px group-hover/send:-translate-y-px group-active/send:translate-x-[0.5px] group-active/send:translate-y-px" />
          </button>
        </div>

        {(value || (allowQueueWhileBusy && queuedCount > 0)) && (
          <button
            type="button"
            onClick={handleClear}
            className="flex-shrink-0 mb-3 text-[11px] font-sans tracking-[0.04em] uppercase text-smoke hover:text-vermillion transition-colors duration-200"
          >
            Clear
          </button>
        )}
      </div>

      {composerAssistEnabled &&
        value.trim().length > 0 &&
        value.trim().length < composerMinDraftChars &&
        !assistLoading && (
          <div className="mt-2 pl-2 pr-12 text-[11px] font-sans text-fog/50 italic min-h-[1.15rem]" aria-live="polite">
            输入辅助已开：再打约{' '}
            {Math.max(0, composerMinDraftChars - value.trim().length)} 个字后即会给出续写建议（Press Tab 采纳）。
          </div>
        )}

      {composerAssistEnabled && (assistLoading || suggestion !== '') && (
        <div
          className="mt-2 pl-2 pr-12 text-[12px] font-sans leading-relaxed text-fog/65 min-h-[1.35rem]"
          aria-live="polite"
        >
          {assistLoading ? (
            <span className="animate-pulse italic text-fog/55">Preparing writing help…</span>
          ) : (
            <span>
              <span className="font-medium text-indigo/[0.78]">Suggestion</span>
              {' · '}
              <span className="text-mist/[0.75]">{suggestion}</span>
              {' '}
              <span className="text-fog/45">Press Tab · Esc clears</span>
            </span>
          )}
        </div>
      )}
    </div>
  )
}
