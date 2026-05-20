// MessageBubble — single chat message
// Supports 3 types: text, tool_call (CC-style dot), form_submitted (read-only record)

import { memo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import GlassCard from '@intera/shared/ui/glass-card'
import FormCard from './form-card'
import IntentClarificationCard from './intent-clarification-card'
import InteractionCard from './interaction-card'
import StreamingText from '@/components/ui/streaming-text'

// ─── Shared message shape ───

export interface MessageShape {
  id: string
  role: 'user' | 'assistant'
  msgType:
    | 'text'
    | 'tool_call'
    | 'policy_block'
    | 'form_active'
    | 'form_submitted'
    | 'intent_clarification'
    | 'intent_resolved'
    | 'interaction_proposed'
    | 'interaction_resolved'
  content: string
  isStreaming?: boolean
  thinking?: string
  thinkingStartedAt?: string
  toolStatus?: 'executing' | 'completed' | 'error'
  toolName?: string
  toolVerb?: string
  toolResult?: unknown
  relatedCaseId?: string
  formData?: {
    title: string
    description?: string
    fields: Array<{ key: string; label: string; type: string; required?: boolean; placeholder?: string; options?: string[] }>
    answers?: Record<string, string>
  }
  intentOptions?: {
    caseTypes: Array<{
      type: string
      displayName: string
      icon: string
      confidence: number
    }>
  }
  intentResolution?: {
    selectedCaseTypes: string[]
    labelsByType: Record<string, string>
    locale: 'zh' | 'en'
  }
  interactionOptions?: any
  timestamp: string
}

interface MessageBubbleProps {
  msg: MessageShape
  priorUserContent?: string
  elevateInteractiveForms?: boolean
  onFormSubmit?: (msgId: string, answers: Record<string, string>) => void | Promise<void>
  onFormCancel?: (msgId: string) => void
  onIntentConfirm?: (msgId: string, selectedTypes: string[]) => void | Promise<void>
  onInteractionSelect?: (msgId: string, optionId: string, input?: string) => void | Promise<void>
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

function MessageBubble({
  msg,
  priorUserContent,
  elevateInteractiveForms = false,
  onFormSubmit,
  onFormCancel,
  onIntentConfirm,
  onInteractionSelect,
}: MessageBubbleProps) {
  const { role, msgType, content, isStreaming, thinking, thinkingStartedAt, toolStatus, toolName, toolVerb, toolResult, formData, intentOptions, intentResolution, interactionOptions, relatedCaseId } = msg

  if (msgType === 'tool_call') {
    return <ToolCallBubble toolName={toolName} toolVerb={toolVerb} status={toolStatus} toolResult={toolResult} timestamp={msg.timestamp} />
  }

  if (msgType === 'policy_block') {
    return <PolicyBlockBubble toolName={toolName} policyNames={content} timestamp={msg.timestamp} />
  }

  if (msgType === 'form_submitted' && formData) {
    return <FormSubmittedBubble formData={formData} />
  }

  if (msgType === 'form_active' && formData) {
    const typedFields = formData.fields as Array<{
      key: string
      label: string
      type: 'text' | 'number' | 'select' | 'textarea' | 'file' | 'date'
      required?: boolean
      placeholder?: string
      options?: string[]
    }>

    const formUi = (
      <FormCard
        title={formData.title}
        description={formData.description}
        fields={typedFields}
        onSubmit={(answers) => onFormSubmit?.(msg.id, answers)}
        onCancel={() => onFormCancel?.(msg.id)}
      />
    )

    if (elevateInteractiveForms && typeof document !== 'undefined') {
      const hintZh =
        !!(priorUserContent && /[\u4e00-\u9fff]/.test(priorUserContent)) ||
        /[\u4e00-\u9fff]/.test(formData.title)
      return (
        <>
          {createPortal(
            <div
              className="fixed inset-0 z-[130] flex items-center justify-center bg-[oklch(0.21_0.02_75/0.34)] p-4 backdrop-blur-[2px]"
              role="dialog"
              aria-modal="true"
              aria-labelledby={`case-form-${msg.id}`}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 44 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                className="relative w-[min(100%,26rem)]"
              >
                <span id={`case-form-${msg.id}`} className="sr-only">
                  {formData.title}
                </span>
                {formUi}
              </motion.div>
            </div>,
            document.body,
          )}
          <div className="animate-message-in w-full max-w-chat rounded-xl border border-dashed border-indigo/22 bg-white/[0.03] px-4 py-3">
            <p className="text-[11px] leading-relaxed text-fog/50">
              {hintZh
                ? '工单需要从您这里确认的信息已在屏幕中央弹出；填完后表单会收口到对话记录，您可以继续与 Core 闲聊。'
                : 'Information needed for your case is in the center window. After submit, it records here—you can keep chatting with the assistant.'}
            </p>
          </div>
        </>
      )
    }

    return (
      <div className="flex flex-col items-start">
        <div className="max-w-[95%] animate-message-in">{formUi}</div>
      </div>
    )
  }

  if (msgType === 'intent_resolved' && intentResolution) {
    return <IntentResolvedBubble intentResolution={intentResolution} timestamp={msg.timestamp} />
  }

  if (msgType === 'interaction_proposed' && interactionOptions) {
    const locale: 'zh' | 'en' = priorUserContent && /[一-鿿]/.test(priorUserContent) ? 'zh' : 'en'
    return (
      <div className="flex flex-col items-start">
        <div className="max-w-[95%] animate-message-in">
          <InteractionCard
            locale={locale}
            title={interactionOptions.title || ''}
            description={interactionOptions.description || ''}
            options={interactionOptions}
            multiSelect={!!interactionOptions.multiSelect}
            onSelect={(optionId, input) => void onInteractionSelect?.(msg.id, optionId, input)}
          />
        </div>
      </div>
    )
  }

  if (msgType === 'interaction_resolved') {
    return (
      <div className="flex items-start px-3 py-2 text-[var(--fog)] text-xs select-none gap-1.5">
        <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[var(--success)]/15 shrink-0">
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 4.5L3.5 6.5L7.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--success)]" /></svg>
        </span>
        {content || '已确认'}
      </div>
    )
  }

  if (msgType === 'intent_clarification' && intentOptions) {
    const locale: 'zh' | 'en' = priorUserContent && /[一-鿿]/.test(priorUserContent) ? 'zh' : 'en'
    return (
      <div className="flex flex-col items-start">
        <div className="max-w-[95%] animate-message-in">
          <IntentClarificationCard
            locale={locale}
            options={intentOptions.caseTypes}
            onConfirm={(selectedTypes) => void onIntentConfirm?.(msg.id, selectedTypes)}
          />
        </div>
      </div>
    )
  }

  // ── text message ──
  const variant = role === 'user' ? 'chat-user' : 'chat-assistant'
  const align = role === 'user' ? 'items-end' : 'items-start'
  const maxW = role === 'user' ? 'max-w-[85%]' : 'max-w-[90%]'

  // Don't render empty text bubbles — RespondingBubble handles the loading indicator.
  // This also prevents orphaned streaming placeholder messages from showing as "...".
  if (!content) return null

  return (
    <div className={`flex flex-col ${align}`}>
      {/* Case tag — shows which case this assistant message belongs to */}
      {role === 'assistant' && relatedCaseId && (
        <span className="text-[9px] font-mono text-fog/30 mb-1 ml-1 tracking-wider">
          {relatedCaseId.length > 12 ? `…${relatedCaseId.slice(-10)}` : relatedCaseId}
        </span>
      )}
      <div className={`${maxW} animate-message-in`}>
        <GlassCard variant={variant}>
          {role === 'assistant' && thinking && (
            <details className="mb-3 group" open={isStreaming}>
              <summary className="text-[12px] font-sans text-fog/40 hover:text-fog/60 cursor-pointer transition-colors select-none">
                {isStreaming
                  ? 'Thinking…'
                  : (() => {
                      const start = thinkingStartedAt ? new Date(thinkingStartedAt).getTime() : Date.now()
                      const duration = Math.max(0.1, (Date.now() - start) / 1000)
                      return `Thought ${duration.toFixed(1)}s`
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
                {content}
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

function IntentResolvedBubble({
  intentResolution,
  timestamp,
}: {
  intentResolution: NonNullable<MessageShape['intentResolution']>
  timestamp: string
}) {
  const { selectedCaseTypes, labelsByType, locale } = intentResolution
  const joined = selectedCaseTypes.map((t) => labelsByType[t] ?? t).join(locale === 'zh' ? '、' : ', ')
  const eyebrow = locale === 'zh' ? '已确认的工单类型' : 'Confirmed issue types'
  const line =
    locale === 'zh'
      ? `您选择了「${joined}」，系统将并行开启对应专项并按顺序处理交互请求…`
      : `You selected “${joined}”. Parallel investigations start now; interactions queue one at a time…`

  return (
    <div className="flex flex-col items-start">
      <div className="max-w-[90%] animate-message-in">
        <div className="relative rounded-2xl bg-abyss/80 backdrop-blur-xl px-4 py-3 border border-[var(--border-subtle)]">
          <p className="text-[10px] font-sans tracking-[0.12em] uppercase text-fog/45">{eyebrow}</p>
          <ul className="mt-2 space-y-1">
            {selectedCaseTypes.map((t) => (
              <li key={t} className="font-serif text-[15px] text-mist">
                · {labelsByType[t] ?? t}
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-fog/55 mt-2 leading-relaxed">{line}</p>
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

// ─── Tool call bubble (CC-style green/red dot) ────────────────────

function ToolCallBubble({ toolName, toolVerb, status, toolResult, timestamp }: {
  toolName?: string
  toolVerb?: string
  status?: 'executing' | 'completed' | 'error'
  toolResult?: unknown
  timestamp: string
}) {
  const displayName = toolName ? toolName.replace(/_/g, ' ') : 'tool'
  const label = toolVerb || displayName
  const [expanded, setExpanded] = useState(false)
  const hasResult = status === 'completed' && toolResult !== undefined

  return (
    <div className="flex flex-col items-start">
      <div className="animate-message-in">
        <div
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border-subtle)] ${hasResult ? 'cursor-pointer' : ''}`}
          onClick={hasResult ? () => setExpanded(!expanded) : undefined}
          role={hasResult ? 'button' : undefined}
          tabIndex={hasResult ? 0 : undefined}
          onKeyDown={hasResult ? (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded) }} : undefined}
        >
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
          {hasResult && (
            <span className="text-[10px] text-fog/40">{expanded ? '▾' : '▸'}</span>
          )}
        </div>
      </div>
      {expanded && hasResult && (
        <div className="animate-message-in mt-1 ml-4 px-3 py-2 rounded-lg bg-[var(--surface)]/50 border border-[var(--border-subtle)] max-w-[420px]">
          <pre className="text-[11px] font-mono text-fog/60 whitespace-pre-wrap break-all leading-relaxed">
            {typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2)}
          </pre>
        </div>
      )}
      {timestamp && (
        <span className="mt-1.5 text-[11px] font-sans text-fog/30 px-2 select-none">
          {formatTime(timestamp)}
        </span>
      )}
    </div>
  )
}

// ─── Policy blocked bubble (red dot) ──────────────────────────────

function PolicyBlockBubble({ toolName, policyNames, timestamp }: {
  toolName?: string
  policyNames?: string
  timestamp: string
}) {
  const isEscalation = toolName === 'escalated'
  const displayTool = toolName && toolName !== 'escalated' ? toolName.replace(/_/g, ' ') : ''
  const displayPolicy = policyNames ? policyNames.replace(/_/g, ' ') : 'policy'

  return (
    <div className="flex flex-col items-start">
      <div className="animate-message-in">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border-subtle)]">
          <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${isEscalation ? 'bg-amber-400' : 'bg-vermillion'}`} />
          <span className="text-[12px] font-mono text-fog/70">
            {isEscalation ? (
              displayPolicy
            ) : (
              <>Blocked <span className="text-fog/50">{displayTool}</span><span className="text-fog/40"> — {displayPolicy}</span></>
            )}
          </span>
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
