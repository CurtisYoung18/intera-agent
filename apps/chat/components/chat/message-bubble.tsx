// MessageBubble — single chat message
// Supports 3 types: text, tool_call (CC-style dot), form_submitted (read-only record)

import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import GlassCard from '@intera/shared/ui/glass-card'
import FormCard from './form-card'
import StreamingText from '@/components/ui/streaming-text'

// ─── Shared message shape ───

export interface MessageShape {
  id: string
  role: 'user' | 'assistant'
  msgType: 'text' | 'tool_call' | 'form_active' | 'form_submitted'
  content: string
  isStreaming?: boolean
  thinking?: string
  thinkingStartedAt?: string
  toolStatus?: 'executing' | 'completed' | 'error'
  toolName?: string
  toolVerb?: string
  formData?: {
    title: string
    description?: string
    fields: Array<{ key: string; label: string; type: string; required?: boolean; placeholder?: string; options?: string[] }>
    answers?: Record<string, string>
  }
  timestamp: string
}

interface MessageBubbleProps {
  msg: MessageShape
  onFormSubmit?: (msgId: string, answers: Record<string, string>) => void
  onFormCancel?: (msgId: string) => void
}

// ─── Markdown components ──────────────────────────────────────────

const MARKDOWN_COMPONENTS: any = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="font-serif text-[16px] sm:text-[18px] leading-relaxed text-mist text-balance">{children}</p>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-medium text-mist">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <em className="italic text-mist/90">{children}</em>
  ),
  code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
    const isInline = !className
    if (isInline) {
      return <code className="font-mono text-[13px] sm:text-[14px] px-1.5 py-0.5 rounded bg-[var(--surface-hover)] text-indigo-300">{children}</code>
    }
    return <code className="block font-mono text-[13px] leading-relaxed p-3 rounded-md bg-[var(--surface-hover)] border border-[var(--border-subtle)] overflow-x-auto whitespace-pre-wrap">{children}</code>
  },
  pre: ({ children }: { children?: React.ReactNode }) => <pre className="my-2">{children}</pre>,
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc list-inside space-y-1 my-2 font-serif text-[16px] sm:text-[18px] leading-relaxed text-mist/90">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal list-inside space-y-1 my-2 font-serif text-[16px] sm:text-[18px] leading-relaxed text-mist/90">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li className="text-mist/90">{children}</li>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-400 underline underline-offset-2 hover:text-indigo-300 transition-colors">{children}</a>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-[var(--border-hover)] pl-4 my-2 italic text-mist/70">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-[var(--border-subtle)]" />,
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className="font-serif text-[22px] font-medium text-mist mt-3 mb-2">{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className="font-serif text-[20px] font-medium text-mist mt-3 mb-2">{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="font-sans text-[15px] font-medium text-mist mt-2 mb-1">{children}</h3>,
}

// ─── Component ────────────────────────────────────────────────────

function MessageBubble({ msg, onFormSubmit, onFormCancel }: MessageBubbleProps) {
  const { role, msgType, content, isStreaming, thinking, thinkingStartedAt, toolStatus, toolName, toolVerb, formData } = msg

  if (msgType === 'tool_call') {
    return <ToolCallBubble toolName={toolName} toolVerb={toolVerb} status={toolStatus} timestamp={msg.timestamp} />
  }

  if (msgType === 'form_submitted' && formData) {
    return <FormSubmittedBubble formData={formData} />
  }

  if (msgType === 'form_active' && formData) {
    return (
      <div className="flex flex-col items-start">
        <div className="max-w-[95%] animate-message-in">
          <FormCard
            title={formData.title}
            description={formData.description}
            fields={formData.fields as Array<{ key: string; label: string; type: 'text' | 'number' | 'select' | 'textarea' | 'file'; required?: boolean; placeholder?: string; options?: string[] }>}
            onSubmit={(answers) => onFormSubmit?.(msg.id, answers)}
            onCancel={() => onFormCancel?.(msg.id)}
          />
        </div>
      </div>
    )
  }

  // ── text message ──
  const variant = role === 'user' ? 'chat-user' : 'chat-assistant'
  const align = role === 'user' ? 'items-end' : 'items-start'
  const maxW = role === 'user' ? 'max-w-[85%]' : 'max-w-[90%]'

  // Don't render placeholder bubble while waiting for first text — RespondingBubble handles loading indication
  if (!content && isStreaming) return null

  return (
    <div className={`flex flex-col ${align}`}>
      <div className={`${maxW} animate-message-in`}>
        <GlassCard variant={variant}>
          {role === 'assistant' && thinking && (
            <details className="mb-3 group">
              <summary className="text-[12px] font-sans text-fog/40 hover:text-fog/60 cursor-pointer transition-colors select-none">
                {(() => {
                  const start = thinkingStartedAt ? new Date(thinkingStartedAt).getTime() : Date.now()
                  const duration = Math.max(1, Math.round((Date.now() - start) / 1000))
                  return `Thought ${duration}s`
                })()}
              </summary>
              <div className="mt-2 pl-3 border-l-2 border-indigo/20 text-[13px] text-fog/50 leading-relaxed whitespace-pre-wrap font-sans">
                {thinking}
              </div>
            </details>
          )}
          <div className="font-serif text-[16px] sm:text-[18px] leading-relaxed text-mist">
            {role === 'assistant' && isStreaming ? (
              <StreamingText text={content} isStreaming />
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                {content || (isStreaming ? '' : '...')}
              </ReactMarkdown>
            )}
          </div>
        </GlassCard>
      </div>

      {msg.timestamp && (
        <span className="mt-1.5 text-[11px] font-sans text-fog/30 px-2 select-none">
          {formatTime(msg.timestamp)}
        </span>
      )}
    </div>
  )
}

// ─── Tool call bubble (CC-style green/red dot) ────────────────────

function ToolCallBubble({ toolName, toolVerb, status, timestamp }: {
  toolName?: string
  toolVerb?: string
  status?: 'executing' | 'completed' | 'error'
  timestamp: string
}) {
  const displayName = toolName ? toolName.replace(/_/g, ' ') : 'tool'
  const label = toolVerb || displayName

  return (
    <div className="flex flex-col items-start">
      <div className="animate-message-in">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border-subtle)]">
          {/* CC-style status dot */}
          {status === 'executing' && (
            <span className="inline-block w-2 h-2 rounded-full border border-indigo/60 border-l-transparent animate-tool-spin flex-shrink-0" />
          )}
          {status === 'completed' && (
            <span className="inline-block w-2 h-2 rounded-full bg-malachite flex-shrink-0" />
          )}
          {status === 'error' && (
            <span className="inline-block w-2 h-2 rounded-full bg-vermillion flex-shrink-0" />
          )}

          <span className="text-[12px] font-mono text-fog/70">{label}</span>
        </div>
      </div>
      {timestamp && (
        <span className="mt-1.5 text-[11px] font-sans text-fog/30 px-2 select-none">
          {formatTime(timestamp)}
        </span>
      )}
    </div>
  )
}

// ─── Submitted form bubble (read-only record) ─────────────────────

function FormSubmittedBubble({ formData }: {
  formData: NonNullable<MessageShape['formData']>
}) {
  const { title, description, fields, answers } = formData

  return (
    <div className="flex flex-col items-start">
      <div className="max-w-[90%] animate-message-in">
        <div className="relative rounded-2xl bg-abyss/80 backdrop-blur-xl px-4 py-3 border border-[var(--border-subtle)]">
          <h3 className="font-serif text-[15px] text-mist mb-0.5">{title}</h3>
          {description && (
            <p className="text-[11px] text-fog/40 mb-3">{description}</p>
          )}
          <div className="space-y-2">
            {fields.map((field) => {
              const value = answers?.[field.key]
              return (
                <div key={field.key}>
                  <span className="text-[10px] font-sans tracking-[0.03em] uppercase text-fog/40">{field.label}</span>
                  <p className="text-[13px] text-mist/70">{value || '—'}</p>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  } catch {
    return ''
  }
}

export default memo(MessageBubble)
