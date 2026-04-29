// MessageBubble — single chat message (user or assistant)
// Supports markdown rendering via react-markdown
// Shows GMT+8 timestamp on hover

import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import GlassCard from '@intera/shared/ui/glass-card'

interface ToolUseInfo {
  name: string
  status: 'executing' | 'completed' | 'error'
}

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
  toolUses?: ToolUseInfo[]
  timestamp?: string
  className?: string
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const h = d.getHours().toString().padStart(2, '0')
    const m = d.getMinutes().toString().padStart(2, '0')
    return `${h}:${m}`
  } catch {
    return ''
  }
}

// Markdown component overrides — styled for Void aesthetic
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MARKDOWN_COMPONENTS: any = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="font-serif text-[16px] sm:text-[18px] leading-relaxed text-mist text-balance">
      {children}
    </p>
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
      return (
        <code className="font-mono text-[13px] sm:text-[14px] px-1.5 py-0.5 rounded bg-white/[0.06] text-indigo-300">
          {children}
        </code>
      )
    }
    return (
      <code className="block font-mono text-[13px] leading-relaxed p-3 rounded-md bg-white/[0.04] border border-white/[0.06] overflow-x-auto whitespace-pre-wrap">
        {children}
      </code>
    )
  },
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="my-2">{children}</pre>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc list-inside space-y-1 my-2 font-serif text-[16px] sm:text-[18px] leading-relaxed text-mist/90">
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal list-inside space-y-1 my-2 font-serif text-[16px] sm:text-[18px] leading-relaxed text-mist/90">
      {children}
    </ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="text-mist/90">{children}</li>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-400 underline underline-offset-2 hover:text-indigo-300 transition-colors">
      {children}
    </a>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-white/[0.08] pl-4 my-2 italic text-mist/70">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-white/[0.06]" />,
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="font-serif text-[22px] font-medium text-mist mt-3 mb-2">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="font-serif text-[20px] font-medium text-mist mt-3 mb-2">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="font-sans text-[15px] font-medium text-mist mt-2 mb-1">{children}</h3>
  ),
}

function MessageBubble({
  role,
  content,
  isStreaming = false,
  toolUses,
  timestamp,
  className = '',
}: MessageBubbleProps) {
  const variant = role === 'user' ? 'chat-user' : 'chat-assistant'
  const align = role === 'user' ? 'items-end' : 'items-start'
  const maxW = role === 'user' ? 'max-w-[85%]' : 'max-w-[90%]'

  return (
    <div className={`flex flex-col ${align} ${className}`}>
      <div className={`${maxW} animate-message-in`}>
        <GlassCard variant={variant}>
          {/* Tool indicators */}
          {toolUses && toolUses.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
              {toolUses.map((tool, i) => (
                <ToolBadge key={`${tool.name}-${i}`} tool={tool} />
              ))}
            </div>
          )}

          {/* Markdown content */}
          <div className="markdown-content">
            {content ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={MARKDOWN_COMPONENTS}
              >
                {content}
              </ReactMarkdown>
            ) : isStreaming ? (
              /* Claude Code-style thinking indicator — staggered dots */
              <ThinkingPlaceholder />
            ) : (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={MARKDOWN_COMPONENTS}
              >
                ...
              </ReactMarkdown>
            )}
          </div>

          {/* Streaming cursor — only when content is actively streaming */}
          {isStreaming && content && (
            <span className="inline-block ml-[2px] w-[2px] h-[1em] bg-white/50 animate-pulse align-middle" />
          )}
        </GlassCard>
      </div>

      {/* Short time */}
      {timestamp && (
        <span className="mt-1.5 text-[11px] font-sans text-fog/30 px-2 select-none">
          {formatTime(timestamp)}
        </span>
      )}
    </div>
  )
}

// Tool status badge
function ToolBadge({ tool }: { tool: ToolUseInfo }) {
  const statusColor = {
    executing: 'text-indigo',
    completed: 'text-malachite',
    error: 'text-vermillion',
  }[tool.status]

  const shortName = tool.name
    .replace(/_/g, ' ')
    .replace('query ', '')
    .replace('payment channel status', 'channel status')

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 whitespace-nowrap
        text-[10px] sm:text-[11px] font-sans tracking-[0.03em] uppercase
        ${statusColor}
      `}
    >
      {tool.status === 'executing' && (
        <span className="inline-block w-3 h-3 rounded-full border border-current border-l-transparent animate-tool-spin" />
      )}
      {tool.status === 'completed' && (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
      )}
      {tool.status === 'error' && (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
      )}
      {shortName}
    </span>
  )
}

export default memo(MessageBubble)

// Claude Code-style "Thinking..." with staggered dot animation
function ThinkingPlaceholder() {
  return (
    <span className="inline-flex items-center gap-[3px] text-fog/50 font-serif text-[16px] sm:text-[18px] italic">
      Thinking
      <span className="inline-flex gap-[3px]">
        <span className="inline-block w-1 h-1 rounded-full bg-fog/60 animate-thinking-dots" />
        <span className="inline-block w-1 h-1 rounded-full bg-fog/60 animate-thinking-dots" style={{ animationDelay: '0.2s' }} />
        <span className="inline-block w-1 h-1 rounded-full bg-fog/60 animate-thinking-dots" style={{ animationDelay: '0.4s' }} />
      </span>
    </span>
  )
}
