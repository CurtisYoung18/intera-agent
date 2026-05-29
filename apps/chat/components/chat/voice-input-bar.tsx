'use client'

// VoiceInputBar — always-unlocked input with queue mode
// Shift+Enter for newline, IME-safe Enter to submit
// Optional DeepSeek-prefix composer hints (Tab to append) when Console enables assist

import { useState, useCallback, useEffect, useRef } from 'react'
import GlassInput from '@intera/shared/ui/glass-input'
import type { KeyboardEvent as ReactKb } from 'react'

interface VoiceInputBarProps {
  onSubmit: (text: string, contentBlocks?: { type: string; text?: string; source?: { type: string; media_type: string; data: string } }[]) => void
  queuedCount: number
  onClearQueue: () => void
  isResponding?: boolean
  allowQueueWhileBusy?: boolean
  composerAssistEnabled?: boolean
  vendorId?: string
  assistMissingDeepseekKey?: boolean
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
  vendorId = 'default',
  assistMissingDeepseekKey = false,
  composerMinDraftChars = 4,
}: VoiceInputBarProps) {
  const [value, setValue] = useState('')
  const [suggestion, setSuggestion] = useState('')
  const [assistLoading, setAssistLoading] = useState(false)
  const [images, setImages] = useState<{ data: string; mediaType: string; name: string }[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
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
          body: JSON.stringify({ draft: value, vendorId }),
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
  }, [value, composerAssistEnabled, vendorId, composerMinDraftChars])

  const handleChange = useCallback((newValue: string) => {
    setValue(newValue)
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      const reader = new FileReader()
      reader.onload = () => {
        const data = (reader.result as string).split(',')[1]
        if (data) {
          setImages((prev) => [...prev, { data, mediaType: file.type, name: file.name }])
        }
      }
      reader.readAsDataURL(file)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const removeImage = useCallback((idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  const handleSubmit = useCallback(() => {
    const hasText = value.trim().length > 0
    const hasImages = images.length > 0
    if (!hasText && !hasImages) return
    setSuggestion('')

    let contentBlocks: { type: string; text?: string; source?: { type: string; media_type: string; data: string } }[] | undefined
    if (hasImages) {
      contentBlocks = images.map((img) => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.data },
      }))
      if (hasText) {
        contentBlocks.unshift({ type: 'text', text: value.trim() })
      }
    }

    const text = hasText ? value.trim() : (hasImages ? `[用户上传了 ${images.length} 张图片]` : '')
    onSubmit(text, contentBlocks)
    setValue('')
    setImages([])
  }, [value, images, onSubmit])

  const canSend = value.trim().length > 0 || images.length > 0

  const handleClear = useCallback(() => {
    setValue('')
    setSuggestion('')
    setImages([])
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

      {/* Image previews */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 pb-2">
          {images.map((img, idx) => (
            <div key={idx} className="relative group w-16 h-16 rounded-lg overflow-hidden border border-[var(--border-subtle)]">
              <img
                src={`data:${img.mediaType};base64,${img.data}`}
                alt={img.name}
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => removeImage(idx)}
                className="absolute top-0.5 right-0.5 w-5 h-5 flex items-center justify-center rounded-full bg-black/60 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={`Remove ${img.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Image upload button */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileChange}
          className="hidden"
          aria-label="Upload images"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex-shrink-0 mb-3 h-8 w-8 flex items-center justify-center rounded-full text-fog/50 hover:text-fog/80 hover:bg-[var(--surface)] transition-colors"
          aria-label="Attach image"
          title="Attach image"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </button>

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
            className="group/send mt-px flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo/[0.14] text-indigo/[0.92] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] outline-none ring-1 ring-black/[0.04] transition-[transform,opacity,background-color,box-shadow] duration-150 hover:enabled:bg-indigo/[0.22] hover:enabled:text-indigo active:enabled:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-[0.28] focus-visible:ring-2 focus-visible:ring-indigo/35"
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
