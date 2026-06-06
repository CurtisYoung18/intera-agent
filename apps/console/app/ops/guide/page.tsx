'use client'

import { useState, type ReactNode } from 'react'
import { BookOpen, Sparkles, Copy, Check, ExternalLink } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'
import {
  AgentTurnPipelineDiagram,
  CaseLifecycleDiagram,
  FactsEvidenceDiagram,
  IntentRoutingFlowDiagram,
  StageNudgeFlowDiagram,
  SubAgentDispatchDiagram,
} from '@/components/ops/runtime-guide-diagrams'
import {
  DocCallout,
  DocList,
  DocParagraph,
  DocSection,
  GuideTableOfContents,
  StickyDocAside,
} from '@/components/ops/runtime-guide-doc-layout'

// ─────────────────────────────────────────────────────────────────────────────
// Hosts (single source of truth)
// ─────────────────────────────────────────────────────────────────────────────

const CHAT_HOST = process.env.NEXT_PUBLIC_APP_URL || 'https://demo.anytrans.ai'
const CONSOLE_HOST = process.env.NEXT_PUBLIC_APP_URL || 'https://demo.anytrans.ai'
const CHAT_UI_URL = '#'

// ─────────────────────────────────────────────────────────────────────────────
// Inline helpers — kept in this file so the guide page is self-contained
// ─────────────────────────────────────────────────────────────────────────────

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* fail silently */
    }
  }
  return (
    <button
      onClick={handleCopy}
      type="button"
      className="inline-flex items-center gap-1 rounded-md border border-black/[0.08] bg-white/70 px-2 py-1 text-[10px] font-medium text-[var(--fog)] backdrop-blur-sm transition-colors hover:bg-white hover:text-[var(--mist)]"
      aria-label={label}
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-emerald-500" /> Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" /> {label}
        </>
      )}
    </button>
  )
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-emerald-500/[0.1] text-emerald-700 border-emerald-500/30',
  POST: 'bg-teal-500/[0.1] text-teal-700 border-teal-500/30',
  PUT: 'bg-amber-500/[0.1] text-amber-700 border-amber-500/30',
  DELETE: 'bg-vermillion/[0.1] text-vermillion border-vermillion/30',
}

interface EndpointProps {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  host: string
  summary: string
  description?: string
  headers?: Record<string, string>
  query?: Array<{ name: string; desc: string; required?: boolean }>
  body?: string // raw JSON example
  bodyFields?: Array<{ name: string; type: string; desc: string; required?: boolean }>
  response?: string // raw example
  responseNote?: string
  notes?: string[]
}

function buildCurl({ method, path, host, headers, body }: EndpointProps): string {
  const fullUrl = `${host}${path}`
  const parts: string[] = [`curl -X ${method} '${fullUrl}'`]
  const allHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers ?? {}),
  }
  if (method === 'GET' || method === 'DELETE') delete allHeaders['Content-Type']
  for (const [k, v] of Object.entries(allHeaders)) {
    parts.push(`  -H '${k}: ${v}'`)
  }
  if (body) {
    parts.push(`  -d '${body.replace(/'/g, "'\\''")}'`)
  }
  if (method === 'POST' && path.includes('/messages')) {
    parts.push(`  --no-buffer  # SSE streaming response`)
  }
  return parts.join(' \\\n')
}

function Endpoint(props: EndpointProps) {
  const { method, path, host, summary, description, headers, query, body, bodyFields, response, responseNote, notes } = props
  const curl = buildCurl(props)

  return (
    <div className="!mt-4 overflow-hidden rounded-xl border border-black/[0.08] bg-white/40 shadow-[var(--shadow-card)] backdrop-blur-md">
      {/* Header bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-black/[0.06] bg-gradient-to-r from-white/60 to-white/30 px-4 py-2.5">
        <span
          className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider ${
            METHOD_COLORS[method] ?? METHOD_COLORS.GET
          }`}
        >
          {method}
        </span>
        <code className="font-mono text-[12px] font-semibold text-[var(--mist)]">{path}</code>
        <span className="ml-auto text-[10px] text-[var(--fog)]/60">{host.replace('https://', '')}</span>
      </div>

      {/* Body */}
      <div className="space-y-3 px-4 py-3">
        <p className="text-[12px] font-medium text-[var(--mist)]">{summary}</p>
        {description ? <p className="text-[11px] leading-relaxed text-[var(--fog)]">{description}</p> : null}

        {/* Headers */}
        {headers && Object.keys(headers).length > 0 ? (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--fog)]/70">Headers</p>
            <ul className="space-y-0.5 text-[11px] text-[var(--fog)]">
              {Object.entries(headers).map(([k, v]) => (
                <li key={k}>
                  <code className="mr-1 rounded bg-black/[0.04] px-1 py-0.5 text-[10px] text-[var(--mist)]">{k}</code>
                  <span>{v}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Query params */}
        {query && query.length > 0 ? (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--fog)]/70">Query Parameters</p>
            <ul className="space-y-0.5 text-[11px] text-[var(--fog)]">
              {query.map((q) => (
                <li key={q.name}>
                  <code className="mr-1 rounded bg-black/[0.04] px-1 py-0.5 text-[10px] text-[var(--mist)]">{q.name}</code>
                  {q.required ? <span className="text-vermillion">*</span> : null}
                  <span> — {q.desc}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Body fields */}
        {bodyFields && bodyFields.length > 0 ? (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--fog)]/70">Request Body Fields</p>
            <ul className="space-y-0.5 text-[11px] text-[var(--fog)]">
              {bodyFields.map((f) => (
                <li key={f.name}>
                  <code className="mr-1 rounded bg-black/[0.04] px-1 py-0.5 text-[10px] text-[var(--mist)]">{f.name}</code>
                  <span className="text-[10px] text-[var(--smoke)]">{f.type}</span>
                  {f.required ? <span className="text-vermillion"> *</span> : null}
                  <span> — {f.desc}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Body JSON */}
        {body ? (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fog)]/70">Request Body</p>
              <CopyButton text={body} label="Copy body" />
            </div>
            <pre className="overflow-x-auto rounded-lg border border-black/[0.05] bg-black/[0.02] p-3 font-mono text-[11px] leading-relaxed text-[var(--mist)]">
              {body}
            </pre>
          </div>
        ) : null}

        {/* Response */}
        {response ? (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--fog)]/70">
              Example Response{responseNote ? ` — ${responseNote}` : ''}
            </p>
            <pre className="overflow-x-auto rounded-lg border border-black/[0.05] bg-black/[0.02] p-3 font-mono text-[11px] leading-relaxed text-[var(--mist)]">
              {response}
            </pre>
          </div>
        ) : null}

        {/* Notes */}
        {notes && notes.length > 0 ? (
          <ul className="list-disc space-y-1 pl-4 text-[11px] text-[var(--fog)]">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        ) : null}

        {/* cURL */}
        <details className="rounded-lg border border-black/[0.05] bg-black/[0.02]">
          <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-[11px] font-semibold text-[var(--mist)] hover:bg-black/[0.03]">
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--fog)]">cURL command</span>
            <CopyButton text={curl} label="Copy curl" />
          </summary>
          <pre className="overflow-x-auto border-t border-black/[0.04] px-3 py-2 font-mono text-[10px] leading-relaxed text-[var(--mist)]">
            {curl}
          </pre>
        </details>
      </div>
    </div>
  )
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="!mt-7 text-[13px] font-semibold tracking-tight text-[var(--mist)]">{children}</h3>
  )
}

function ApiGroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="!mb-2 !mt-6 text-[10px] font-bold uppercase tracking-[0.14em] text-indigo/80">
      {children}
    </p>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SSE event reference (from packages/shared/types/index.ts SSEEventType)
// ─────────────────────────────────────────────────────────────────────────────

const SSE_EVENTS: Array<{ type: string; desc: string }> = [
  { type: 'stream_request_start', desc: 'Loop iteration begins. Emitted once per LLM round-trip.' },
  { type: 'thinking_delta', desc: 'Internal reasoning token (only when showThinking=true).' },
  { type: 'text_delta', desc: 'Visible assistant text token. Concatenate to build the reply.' },
  { type: 'tool_executing', desc: 'A tool/skill is starting execution. Payload: { name, displayVerb, toolUseId }.' },
  { type: 'tool_progress', desc: 'Long-running tool reports incremental progress.' },
  { type: 'skill_call', desc: 'Tool input parsed and accepted (pre-execute event).' },
  { type: 'skill_result', desc: 'Tool finished. Payload: { name, toolUseId, output, latencyMs, renderHints? }.' },
  { type: 'memory_update', desc: 'Case memory dashboard changed (facts, evidence, todos).' },
  { type: 'case_status', desc: 'Case status changed (created → collecting → investigating → resolved).' },
  { type: 'case_created', desc: 'A new case was just created from this user turn.' },
  { type: 'human_task_created', desc: 'Agent created a human task (escalation). Payload: { taskId, question }.' },
  { type: 'form_request', desc: 'Agent wants structured input. Payload: { title, fields[] }. Renders as a form.' },
  { type: 'finalized', desc: 'Case finalized (resolved or escalated terminal state).' },
  { type: 'message_stop', desc: 'Loop iteration ended. Emitted once per LLM round-trip.' },
  { type: 'withheld', desc: 'Internal status — agent is processing additional queued input.' },
  { type: 'consultation_complete', desc: 'Human consultation loop completed.' },
  { type: 'sub_agent_start', desc: 'A sub-agent has been dispatched.' },
  { type: 'sub_agent_progress', desc: 'Sub-agent iteration progress.' },
  { type: 'sub_agent_complete', desc: 'Sub-agent returned findings. Merged into case memory.' },
  { type: 'sub_agent_error', desc: 'Sub-agent execution failed (timeout, error, etc.).' },
  { type: 'core_agent_progress', desc: 'Core (off-case) conversation progress event.' },
  { type: 'policy_blocked', desc: 'A guardrail blocked a tool call. Payload: { toolName, policyNames }.' },
  { type: 'escalated', desc: 'Agent gave up — escalating to human. Includes reason.' },
  { type: 'retry_pending', desc: 'API retry in progress. Payload: { attempt, delayMs, errorClass, message }.' },
  { type: 'error', desc: 'Fatal error (string payload).' },
]

const CONCEPT_KEYS = ['customer', 'channel', 'agent', 'caseType', 'case', 'capability', 'subAgent', 'guardrail'] as const
const ADMIN_KEYS = ['agent', 'capabilities', 'guardrails', 'caseTypes', 'channels', 'subAgents', 'knowledge'] as const

// ─────────────────────────────────────────────────────────────────────────────

export default function OpsGuidePage() {
  const { t } = useConsoleLocale()

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      {/* Header */}
      <header className="animate-fade-up relative mb-10 border-b border-black/[0.06] pb-10 text-center">
        <div className="mb-3 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--fog)]">
          <Sparkles className="h-4 w-4 text-indigo/70" aria-hidden />
          {t('guide.hero.eyebrow')}
        </div>
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo/[0.12] to-lavender/[0.08] shadow-[var(--shadow-card)] ring-1 ring-white/60">
            <BookOpen className="h-7 w-7 text-indigo/90" strokeWidth={2} aria-hidden />
          </div>
          <h1 className="text-[clamp(1.25rem,3vw,1.85rem)] font-bold tracking-tight text-[var(--mist)]">{t('guide.hero.title')}</h1>
          <DocParagraph className="text-[14px] leading-relaxed text-[var(--fog)]" text={t('guide.hero.lead')} />
        </div>
      </header>

      <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-12">
        <StickyDocAside>
          <GuideTableOfContents t={t} />
        </StickyDocAside>

        <main className="min-w-0 flex-1 space-y-2 pt-1">
          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* 1. REST API REFERENCE — pinned to top for Postman testing      */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <DocSection id="guide-api" eyebrow={t('guide.doc.api.eyebrow')} title={t('guide.doc.api.title')}>
            <DocParagraph text={t('guide.doc.api.lead')} />

            <DocCallout>
              <p className="text-[11px]" dangerouslySetInnerHTML={{
                __html: t('guide.doc.api.hostsCallout')
                  .replace('{chatHost}', `<code className="rounded bg-black/[0.04] px-1 py-0.5 text-[10px]">${CHAT_HOST}</code>`)
                  .replace('{consoleHost}', `<code className="rounded bg-black/[0.04] px-1 py-0.5 text-[10px]">${CONSOLE_HOST}</code>`)
              }} />
            </DocCallout>

            {/* ── Group 1: Chat API (integrator-facing) ───────────────────── */}
            <ApiGroupLabel>{t('guide.doc.api.group1Label')}</ApiGroupLabel>

            <SectionHeading>1.1 Send a user message (main entry, SSE)</SectionHeading>
            <Endpoint
              method="POST"
              path="/api/messages"
              host={CHAT_HOST}
              summary="Send a user message and stream back the agent response as SSE events."
              description="This is the primary integration point. The agent auto-creates a case if needed, calls skills, dispatches sub-agents, and emits typed SSE events (see §1.13 below for the full event catalog)."
              headers={{ Accept: 'text/event-stream' }}
              bodyFields={[
                { name: 'message', type: 'string', desc: 'The user’s message.', required: true },
                { name: 'orgId', type: 'string', desc: 'Customer slug. Defaults to "default".' },
                { name: 'userId', type: 'string', desc: 'End-user identifier (groups cases per user).' },
                { name: 'userLabel', type: 'string', desc: 'Optional display name for the user.' },
                { name: 'chatId', type: 'string', desc: 'Conversation session id. Omit for first turn — engine generates one.' },
                { name: 'caseId', type: 'string', desc: 'Existing case id (for resume / continuation).' },
                { name: 'caseType', type: 'string', desc: 'Hint for the case type to create.' },
                { name: 'bootstrapNewCase', type: 'boolean', desc: 'If true, the case was created from an intent selection card.' },
                { name: 'resumeTrigger', type: 'object', desc: 'For human task resolution callback.' },
                { name: 'formResult', type: 'object', desc: '{ caseId, answers }. Submit a form opened by form_request.' },
                { name: 'interactionResult', type: 'object', desc: '{ caseId, optionId, input? }. Submit a choice for an interactive card (deprecated — use formResult instead).' },
                { name: 'contentBlocks', type: 'array', desc: 'Multimodal input (text + image blocks, Anthropic SDK shape).' },
              ]}
              body={`{
  "message": "我充值了 500 元但余额没显示",
  "orgId": "default",
  "userId": "player_123",
  "chatId": ""
}`}
              response={`event: stream_request_start
data: {"type":"stream_request_start","data":null,"timestamp":"2026-05-27T03:26:27.098Z"}

event: case_created
data: {"type":"case_created","data":{"caseId":"case_…","caseType":"deposit_issue","displayName":"充值问题"},"timestamp":"…"}

event: tool_executing
data: {"type":"tool_executing","data":{"name":"query_order_status","displayVerb":{"text":"Checking order status","icon":"scan"},"toolUseId":"toolu_…"},"timestamp":"…"}

event: skill_result
data: {"type":"skill_result","data":{"name":"query_order_status","toolUseId":"toolu_…","output":{"status":"completed","amount":500},"latencyMs":180},"timestamp":"…"}

event: text_delta
data: {"type":"text_delta","data":"已确认您的","timestamp":"…"}

event: message_stop
data: {"type":"message_stop","data":{"reason":"next_turn","stage":"investigating"},"timestamp":"…"}`}
              responseNote="SSE stream (truncated). Consume with EventSource or a fetch-stream reader."
              notes={[
                'Body must be < 100 KB.',
                'orgId must match /^[a-zA-Z0-9_-]+$/ and be ≤ 64 chars.',
                'Response is `text/event-stream`. Each event is `event: <type>\\ndata: <json>\\n\\n`.',
                'For Postman: enable "Stream" mode or use the cURL --no-buffer flag to see events arrive incrementally.',
              ]}
            />

            <SectionHeading>1.2 Health check</SectionHeading>
            <Endpoint
              method="GET"
              path="/api/health"
              host={CHAT_HOST}
              summary="Liveness + DB connectivity probe."
              response={`{
  "status": "ok",
  "db": "connected",
  "timestamp": "2026-05-27T05:30:12.341Z"
}`}
              responseNote="HTTP 200 healthy; HTTP 503 + db:'unreachable' when degraded."
              notes={['Returns 503 if Prisma SELECT 1 fails. Cache-Control: no-store.']}
            />

            <SectionHeading>1.3 List cases for a user</SectionHeading>
            <Endpoint
              method="GET"
              path="/api/cases"
              host={CHAT_HOST}
              summary="List recent cases for a (customer, user) combination."
              query={[
                { name: 'orgId', desc: 'Customer slug. Defaults to "default".' },
                { name: 'userId', desc: 'End-user id. Defaults to "anonymous".' },
                { name: 'chatId', desc: 'Filter by chat session id.' },
                { name: 'limit', desc: 'Max rows. Default 20, max 50.' },
              ]}
              response={`{
  "cases": [
    { "id": "case_…", "type": "deposit_issue", "status": "resolved", "summary": "…", "createdAt": "…", "resolvedAt": "…" }
  ]
}`}
            />

            <SectionHeading>1.4 List messages of one case</SectionHeading>
            <Endpoint
              method="GET"
              path="/api/cases/{id}/messages"
              host={CHAT_HOST}
              summary="Replay the message log of a single case (user, assistant, tool_use, tool_result blocks in order)."
            />

            <SectionHeading>1.5 Send follow-up message into existing case</SectionHeading>
            <Endpoint
              method="POST"
              path="/api/cases/{id}/message"
              host={CHAT_HOST}
              summary="Append a user message to an existing case mid-flow."
              bodyFields={[
                { name: 'message', type: 'string', desc: 'New user message.', required: true },
                { name: 'userId', type: 'string', desc: 'Same userId used to create the case.' },
              ]}
              body={`{ "message": "我刚收到一条通知", "userId": "player_123" }`}
            />

            <SectionHeading>1.6 LiveChat integration</SectionHeading>
            <Endpoint
              method="POST"
              path="/api/livechat/webhook/{orgId}"
              host={CHAT_HOST}
              summary="LiveChat platform webhook (per-customer). Required for LiveChat integration."
              headers={{ 'X-LiveChat-Webhook-Signature': '<HMAC-SHA256 of body>' }}
              notes={[
                'HMAC verified against LIVECHAT_WEBHOOK_SECRET (or per-customer secret).',
                'Returns 200 quickly; processing is fire-and-forget.',
                'Idempotency: same event.id is processed once (webhook_events dedup table).',
                'Legacy URL /api/livechat/webhook (no orgId) still accepted for back-compat.',
              ]}
            />
            <Endpoint
              method="GET"
              path="/api/livechat/config"
              host={CHAT_HOST}
              summary="Read LiveChat config for a customer."
              query={[{ name: 'orgId', desc: 'Customer slug.', required: true }]}
              response={`{
  "orgId": "default",
  "botAccessToken": "…",
  "licenseId": "12345678",
  "showSkillStatus": true,
  "enabled": true
}`}
            />
            <Endpoint
              method="PUT"
              path="/api/livechat/config"
              host={CHAT_HOST}
              summary="Update LiveChat config (called by Console)."
              body={`{
  "orgId": "default",
  "botAccessToken": "Bearer-xxx",
  "licenseId": "12345678",
  "showSkillStatus": true,
  "enabled": true
}`}
            />

            <SectionHeading>1.11 {t('guide.doc.api.sseCatalogTitle')} (consume on /api/messages)</SectionHeading>
            <p className="text-[11px] text-[var(--fog)]" dangerouslySetInnerHTML={{ __html: t('guide.doc.api.sseCatalogNote') }} />
            <div className="!mt-3 overflow-hidden rounded-xl border border-black/[0.06]">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-black/[0.06] bg-black/[0.02] text-left">
                    <th className="px-3 py-2 font-semibold text-[var(--mist)]">type</th>
                    <th className="px-3 py-2 font-semibold text-[var(--mist)]">When emitted</th>
                  </tr>
                </thead>
                <tbody>
                  {SSE_EVENTS.map((e, i) => (
                    <tr key={e.type} className={i % 2 === 0 ? 'bg-white/30' : 'bg-transparent'}>
                      <td className="px-3 py-1.5 font-mono text-[10px] text-teal-700">{e.type}</td>
                      <td className="px-3 py-1.5 text-[var(--fog)]">{e.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Group 2: Console Admin API ─────────────────────────────── */}
            <ApiGroupLabel>{t('guide.doc.api.group2Label')}</ApiGroupLabel>
            <p className="text-[11px] text-[var(--fog)]">{t('guide.doc.api.group2Note')}</p>

            <SectionHeading>2.1 Auth</SectionHeading>
            <Endpoint
              method="POST"
              path="/api/auth/login"
              host={CONSOLE_HOST}
              summary="Log in as a customer. Sets a session cookie used by all admin endpoints."
              bodyFields={[
                { name: 'orgId', type: 'string', desc: 'Customer slug.', required: true },
                { name: 'password', type: 'string', desc: 'Password if the customer has one set. Empty for no-password.' },
              ]}
              body={`{ "orgId": "default", "password": "" }`}
              response={`{ "ok": true, "orgId": "default", "customerName": "Default Tenant" }`}
            />
            <Endpoint method="POST" path="/api/auth/logout" host={CONSOLE_HOST} summary="Clear session cookie." />
            <Endpoint method="GET" path="/api/auth/session" host={CONSOLE_HOST} summary="Inspect current session." response={`{ "orgId": "default", "customerName": "Default Tenant" }`} />
            <Endpoint method="GET" path="/api/admin/customers" host={CONSOLE_HOST} summary="List available customers (for the switcher in sidebar)." />

            <SectionHeading>2.2 Agent profile</SectionHeading>
            <Endpoint
              method="GET"
              path="/api/admin/agent"
              host={CONSOLE_HOST}
              summary="Read the active customer&rsquo;s AgentConfig (prompt, model, memory, generation, etc.)."
            />
            <Endpoint
              method="PUT"
              path="/api/admin/agent"
              host={CONSOLE_HOST}
              summary="Update AgentConfig. Console writes this on Save."
              body={`{
  "systemPrompt": "You are a customer support agent…",
  "model": "MiniMax-M2.7-highspeed",
  "fallbackModel": "claude-haiku-4-5-20251001",
  "temperature": 0.5,
  "thinkingBudget": 4096,
  "maxIterations": 20,
  "maxOutputTokens": 4096,
  "memoryStrategy": "{…JSON…}",
  "policyHooks": "{…JSON…}",
  "showThinking": false,
  "invariantCheck": true
}`}
            />
            <Endpoint method="GET" path="/api/admin/models" host={CONSOLE_HOST} summary="List models available for selection (used by drop-downs)." />

            <SectionHeading>2.3 Skills (Tools)</SectionHeading>
            <Endpoint method="GET" path="/api/admin/skills" host={CONSOLE_HOST} summary="List all enabled skills for the active customer. Returns enriched flags isSystem / isSpecial." />
            <Endpoint
              method="POST"
              path="/api/admin/skills"
              host={CONSOLE_HOST}
              summary="Create a new business skill."
              body={`{
  "name": "query_order_status",
  "description": "Look up an order by ID.",
  "mode": "http",
  "endpoint": "https://api.example.com/orders/{orderId}",
  "httpMethod": "GET",
  "headers": "{\\"Authorization\\":\\"Bearer xxx\\"}",
  "timeoutMs": 8000,
  "inputSchema": "{…JSON Schema…}",
  "outputSchema": "{…JSON Schema…}",
  "isConcurrencySafe": true,
  "enabled": true,
  "displayVerb": { "text": "Checking order", "icon": "scan" }
}`}
            />
            <Endpoint method="GET" path="/api/admin/skills/{name}" host={CONSOLE_HOST} summary="Read a single skill." />
            <Endpoint method="PUT" path="/api/admin/skills/{name}" host={CONSOLE_HOST} summary="Update a skill. System skills (engine-managed) reject everything except `enabled` toggle." />
            <Endpoint method="DELETE" path="/api/admin/skills/{name}" host={CONSOLE_HOST} summary="Delete a business skill. System / special skills can&rsquo;t be deleted." />
            <Endpoint
              method="POST"
              path="/api/admin/skills/test"
              host={CONSOLE_HOST}
              summary="Test an HTTP skill against its endpoint with a dummy or provided input. Returns status + body."
              body={`{ "name": "query_order_status", "input": { "orderId": "TX2026…" } }`}
            />

            <SectionHeading>2.4 Guardrails (a.k.a. Policies)</SectionHeading>
            <Endpoint method="GET" path="/api/admin/policies" host={CONSOLE_HOST} summary="List all guardrails." />
            <Endpoint
              method="POST"
              path="/api/admin/policies"
              host={CONSOLE_HOST}
              summary="Create a guardrail."
              body={`{
  "name": "no_high_risk_account_change",
  "description": "Block high-risk account skills until admin reviews.",
  "hook": "preTool",
  "rule": "{\\"deny_tools\\":[\\"refund_money\\",\\"change_ban_status\\",\\"delete_account\\"]}"
}`}
            />
            <Endpoint method="PUT" path="/api/admin/policies/{name}" host={CONSOLE_HOST} summary="Update a guardrail." />
            <Endpoint method="DELETE" path="/api/admin/policies/{name}" host={CONSOLE_HOST} summary="Delete a guardrail." />

            <SectionHeading>2.5 Case types</SectionHeading>
            <Endpoint method="GET" path="/api/admin/case-types" host={CONSOLE_HOST} summary="List case types (returns key 'types' or 'caseTypes')." />
            <Endpoint
              method="POST"
              path="/api/admin/case-types"
              host={CONSOLE_HOST}
              summary="Create a case type."
              body={`{
  "type": "withdrawal_issue",
  "displayName": "提现问题",
  "executionMode": "stage",
  "stages": ["created","collecting","investigating","resolved"],
  "requiredFacts": "[\\"amount\\",\\"channel\\"]",
  "escalateOn": "[\\"max_nudges\\",\\"missing_evidence\\"]",
  "stageConfigs": "{…JSON keyed by stage name…}"
}`}
            />
            <Endpoint method="PUT" path="/api/admin/case-types/{name}" host={CONSOLE_HOST} summary="Update a case type." />
            <Endpoint method="DELETE" path="/api/admin/case-types/{name}" host={CONSOLE_HOST} summary="Delete a case type." />

            <SectionHeading>2.6 Routing</SectionHeading>
            <Endpoint method="GET" path="/api/admin/routing" host={CONSOLE_HOST} summary="List intent routing rules (keyword → case type pre-classifier)." />
            <Endpoint method="POST" path="/api/admin/routing" host={CONSOLE_HOST} summary="Create a routing rule." />
            <Endpoint method="PUT" path="/api/admin/routing/{name}" host={CONSOLE_HOST} summary="Update a routing rule." />
            <Endpoint method="DELETE" path="/api/admin/routing/{name}" host={CONSOLE_HOST} summary="Delete a routing rule." />

            <SectionHeading>2.7 Knowledge</SectionHeading>
            <Endpoint method="GET" path="/api/admin/knowledge/sources" host={CONSOLE_HOST} summary="List KnowledgeSource rows for this customer." />
            <Endpoint method="POST" path="/api/admin/knowledge/sources" host={CONSOLE_HOST} summary="Create a KnowledgeSource entry." />
            <Endpoint method="GET" path="/api/admin/knowledge/sources/{id}" host={CONSOLE_HOST} summary="Read one source." />
            <Endpoint method="PUT" path="/api/admin/knowledge/sources/{id}" host={CONSOLE_HOST} summary="Update one source." />
            <Endpoint method="DELETE" path="/api/admin/knowledge/sources/{id}" host={CONSOLE_HOST} summary="Delete one source." />
            <Endpoint method="GET" path="/api/admin/knowledge/gptbots" host={CONSOLE_HOST} summary="Read GPTBots API key (masked)." />
            <Endpoint method="PUT" path="/api/admin/knowledge/gptbots" host={CONSOLE_HOST} summary="Update GPTBots API key." />
            <Endpoint
              method="POST"
              path="/api/admin/knowledge/test"
              host={CONSOLE_HOST}
              summary="Send a query to the configured RAG backend (round-trip preview)."
              body={`{ "query": "提现到账时间" }`}
            />

            <SectionHeading>2.8 Cases & traces (read-only, ops)</SectionHeading>
            <Endpoint method="GET" path="/api/cases" host={CONSOLE_HOST} summary="List recent cases (admin view, all users)." query={[{ name: 'orgId', desc: 'Customer slug.' }, { name: 'limit', desc: 'Max rows.' }]} />
            <Endpoint method="GET" path="/api/cases/{id}" host={CONSOLE_HOST} summary="Read case detail." />
            <Endpoint method="GET" path="/api/cases/{id}/messages" host={CONSOLE_HOST} summary="Read message log of a case (admin)." />
            <Endpoint method="GET" path="/api/cases/{id}/traces" host={CONSOLE_HOST} summary="Read engine trace events for a case (iteration-grouped)." />
            <Endpoint method="GET" path="/api/cases/{id}/export" host={CONSOLE_HOST} summary="Export case as JSON (debug bundle)." />
            <Endpoint method="GET" path="/api/chats" host={CONSOLE_HOST} summary="List chat sessions (groups of cases)." />
            <Endpoint method="GET" path="/api/chats/{chatId}" host={CONSOLE_HOST} summary="Read chat session." />
            <Endpoint method="GET" path="/api/chats/{chatId}/traces" host={CONSOLE_HOST} summary="Read trace events of an entire chat session." />

            <SectionHeading>2.9 Cache invalidation</SectionHeading>
            <Endpoint
              method="POST"
              path="/api/admin/config-changed"
              host={CHAT_HOST}
              summary="Notify the chat engine that AgentConfig / Skills / Policies changed — invalidates in-process cache."
              body={`{ "orgId": "default" }`}
              notes={[
                'Also exists at the same path on the Console host; both invalidate their own process caches.',
                'Console PUT endpoints already call this internally — external callers normally don&rsquo;t need to.',
              ]}
            />

            {/* ── Postman quick-start ────────────────────────────────────── */}
            <ApiGroupLabel>{t('guide.doc.api.postmanTitle')}</ApiGroupLabel>
            <ol className="space-y-1.5 pl-5 text-[11px] text-[var(--fog)] list-decimal">
              <li dangerouslySetInnerHTML={{ __html: t('guide.doc.api.postmanP1').replace('{chatHost}', `<code>${CHAT_HOST}</code>`).replace('{consoleHost}', `<code>${CONSOLE_HOST}</code>`) }} />
              <li dangerouslySetInnerHTML={{ __html: t('guide.doc.api.postmanP2') }} />
              <li dangerouslySetInnerHTML={{ __html: t('guide.doc.api.postmanP3') }} />
              <li dangerouslySetInnerHTML={{ __html: t('guide.doc.api.postmanP4') }} />
              <li dangerouslySetInnerHTML={{
                __html: t('guide.doc.api.postmanP5').replace('{chatUiUrl}', `<a class="text-teal-700 underline hover:text-teal-800" href="${CHAT_UI_URL}" target="_blank" rel="noopener noreferrer">${CHAT_UI_URL} <svg class="inline h-3 w-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>`)
              }} />
            </ol>
          </DocSection>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* 2. Intro                                                       */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <DocSection id="guide-intro" eyebrow={t('guide.doc.intro.eyebrow')} title={t('guide.doc.intro.title')}>
            <DocParagraph text={t('guide.doc.intro.p1')} />
            <DocParagraph text={t('guide.doc.intro.p2')} />
            <DocList items={[t('guide.doc.intro.li1'), t('guide.doc.intro.li2'), t('guide.doc.intro.li3'), t('guide.doc.intro.li4')]} />
            <DocCallout>{t('guide.doc.intro.callout')}</DocCallout>
          </DocSection>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* 3. Core abstractions (Intera's 8 first-class concepts)         */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <DocSection id="guide-concepts" eyebrow={t('guide.doc.concepts.eyebrow')} title={t('guide.doc.concepts.title')}>
            <DocParagraph text={t('guide.doc.concepts.lead')} />
            <div className="!mt-6 grid gap-4 md:grid-cols-2">
              {CONCEPT_KEYS.map((key) => (
                <div key={key} className="rounded-xl border border-black/[0.06] bg-gradient-to-br from-white/55 to-[var(--void)]/30 p-4 shadow-[var(--shadow-card)] backdrop-blur-md">
                  <h3 className="text-[13px] font-semibold text-[var(--mist)]">{t(`guide.doc.concepts.${key}Title`)}</h3>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--fog)]">{t(`guide.doc.concepts.${key}Body`)}</p>
                  <p className="mt-2 text-[10px] text-indigo/70">{t(`guide.doc.concepts.${key}Cta`)}</p>
                </div>
              ))}
            </div>
            <DocCallout variant="note">
              <span className="text-[12px]">{t('guide.doc.concepts.callout')}</span>
            </DocCallout>
          </DocSection>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* 4. Routes / where people land                                  */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <DocSection id="guide-routes" eyebrow={t('guide.doc.routes.eyebrow')} title={t('guide.doc.routes.title')}>
            <DocParagraph text={t('guide.doc.routes.lead')} />
            <DocList items={[t('guide.doc.routes.li1'), t('guide.doc.routes.li2'), t('guide.doc.routes.li3'), t('guide.doc.routes.li4')]} />
            <DocCallout variant="note">{t('guide.doc.routes.note')}</DocCallout>
          </DocSection>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* 5. Case lifecycle                                              */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <DocSection id="guide-case-lifecycle" eyebrow={t('guide.doc.lifecycle.eyebrow')} title={t('guide.doc.lifecycle.title')}>
            <DocParagraph text={t('guide.doc.lifecycle.lead')} />
            <div className="!mt-6 rounded-[1.25rem] border border-black/[0.06] bg-gradient-to-br from-white/55 via-white/35 to-[var(--void)]/30 p-5 shadow-[var(--shadow-card)] backdrop-blur-xl sm:p-7">
              <CaseLifecycleDiagram t={t} />
            </div>
            <DocList items={[t('guide.doc.lifecycle.p1'), t('guide.doc.lifecycle.p2'), t('guide.doc.lifecycle.p3'), t('guide.doc.lifecycle.p4'), t('guide.doc.lifecycle.p5')]} />
            <DocCallout>{t('guide.doc.lifecycle.callout')}</DocCallout>
          </DocSection>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* 6. Agent loop engine                                           */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <DocSection id="guide-loop-engine" eyebrow={t('guide.doc.loop.eyebrow')} title={t('guide.doc.loop.title')}>
            <DocParagraph text={t('guide.doc.loop.lead')} />
            <div className="!mt-6 rounded-[1.25rem] border border-black/[0.06] bg-gradient-to-br from-white/55 via-white/35 to-[var(--void)]/30 p-5 shadow-[var(--shadow-card)] backdrop-blur-xl sm:p-7">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]">{t('guide.turnDiag.figureTitle')}</p>
              <AgentTurnPipelineDiagram t={t} />
            </div>
            <DocList className="!mt-8" items={[t('guide.doc.loop.li1'), t('guide.doc.loop.li2'), t('guide.doc.loop.li3'), t('guide.doc.loop.li4'), t('guide.doc.loop.li5')]} />
            <DocCallout variant="note">
              <span className="text-[12px]">
                The engine implements the <strong>tool-result invariant</strong> (S1): every <code>tool_use</code> always gets a matching <code>tool_result</code>, even if the tool was blocked by a guardrail or the stream truncated. Plus <strong>centralized retry</strong> (S2) with classified errors + model fallback. Stability fixes shipped 2026-05-26; see <code>doc/what&rsquo;s done/</code>.
              </span>
            </DocCallout>
          </DocSection>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* 7. Sub-agents                                                  */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <DocSection id="guide-sub-agents" eyebrow={t('guide.doc.sub.eyebrow')} title={t('guide.doc.sub.title')}>
            <DocParagraph text={t('guide.doc.sub.lead')} />
            <div className="!mt-6 rounded-[1.25rem] border border-black/[0.06] bg-gradient-to-br from-white/55 via-white/35 to-[var(--void)]/30 p-5 shadow-[var(--shadow-card)] backdrop-blur-xl sm:p-7">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]">Sub-Agent Dispatch</p>
              <SubAgentDispatchDiagram t={t} />
            </div>
            <DocList items={[t('guide.doc.sub.p1'), t('guide.doc.sub.p2'), t('guide.doc.sub.p3')]} />
            <DocCallout>{t('guide.doc.sub.callout')}</DocCallout>
            <p className="!mt-3 text-[11px] text-[var(--fog)]">
              <strong>Two dispatch modes</strong>: <code>executionMode: &ldquo;stage&rdquo;</code> (config-driven, pinned per stage) or <code>executionMode: &ldquo;cc&rdquo;</code> / Adaptive (LLM decides via <code>dispatch_subagent</code> tool). Sub-agents inherit global guardrails and can override per-agent.
            </p>
          </DocSection>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* 8. Tools & policies                                            */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <DocSection id="guide-tools-policy" eyebrow={t('guide.doc.tools.eyebrow')} title={t('guide.doc.tools.title')}>
            <DocParagraph text={t('guide.doc.tools.lead')} />
            <DocList items={[t('guide.doc.tools.li1'), t('guide.doc.tools.li2'), t('guide.doc.tools.li3'), t('guide.doc.tools.li4'), t('guide.doc.tools.li5'), t('guide.doc.tools.li6')]} />
            <DocCallout variant="note">
              <span className="text-[12px]">
                <strong>3 skill tiers</strong>: <em>System</em> (engine-managed, read-only, e.g. <code>dispatch_case_agent</code>, <code>finalize_case_agent</code>); <em>Special</em> (<code>kb_hybrid_retrieve</code>, configured on Knowledge page); <em>Business</em> (HTTP / mock, fully editable). <strong>Guardrail hooks</strong>: <code>preTool</code> (block call), <code>postTool</code> (validate result), <code>preFinalize</code> (require before close).
              </span>
            </DocCallout>
          </DocSection>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* 9. Facts & memory                                              */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <DocSection id="guide-facts-memory" eyebrow={t('guide.doc.facts.eyebrow')} title={t('guide.doc.facts.title')}>
            <DocParagraph text={t('guide.doc.facts.lead')} />
            <DocList items={[t('guide.doc.facts.li1'), t('guide.doc.facts.li2'), t('guide.doc.facts.li3'), t('guide.doc.facts.li4')]} />
            <div className="!mt-8 rounded-[1.25rem] border border-black/[0.06] bg-gradient-to-br from-white/55 via-white/35 to-[var(--void)]/30 p-5 shadow-[var(--shadow-card)] backdrop-blur-xl sm:p-7">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]">{t('guide.section2.title')}</p>
              <FactsEvidenceDiagram t={t} />
            </div>
          </DocSection>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* 10. Stage runtime                                              */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <DocSection id="guide-stage-runtime" eyebrow={t('guide.doc.stage.eyebrow')} title={t('guide.doc.stage.title')}>
            <DocParagraph text={t('guide.doc.stage.lead')} />
            <DocList items={[t('guide.doc.stage.li1'), t('guide.doc.stage.li2'), t('guide.doc.stage.li3'), t('guide.doc.stage.li4')]} />
            <DocCallout>{t('guide.doc.stage.callout')}</DocCallout>
            <div className="!mt-8 rounded-[1.25rem] border border-black/[0.06] bg-gradient-to-br from-white/55 via-white/35 to-[var(--void)]/30 p-5 shadow-[var(--shadow-card)] backdrop-blur-xl sm:p-7">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]">{t('guide.section1.title')}</p>
              <StageNudgeFlowDiagram t={t} />
            </div>
          </DocSection>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* 11. Intent routing                                             */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <DocSection id="guide-intent-routing" eyebrow={t('guide.doc.intent.eyebrow')} title={t('guide.doc.intent.title')}>
            <DocParagraph text={t('guide.doc.intent.lead')} />
            <div className="!mt-6 rounded-[1.25rem] border border-black/[0.06] bg-gradient-to-br from-white/55 via-white/35 to-[var(--void)]/30 p-5 shadow-[var(--shadow-card)] backdrop-blur-xl sm:p-7">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]">{t('guide.intentDiag.figureTitle')}</p>
              <IntentRoutingFlowDiagram t={t} />
            </div>
            <DocList className="!mt-8" items={[t('guide.doc.intent.li1'), t('guide.doc.intent.li2'), t('guide.doc.intent.li3'), t('guide.doc.intent.li4'), t('guide.doc.intent.li5')]} />
            <DocCallout variant="note">{t('guide.doc.intent.callout')}</DocCallout>
          </DocSection>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* 12. Config lifecycle                                           */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <DocSection id="guide-config-lifecycle" eyebrow={t('guide.doc.config.eyebrow')} title={t('guide.doc.config.title')}>
            <DocParagraph text={t('guide.doc.config.lead')} />
            <DocList items={[t('guide.doc.config.li1'), t('guide.doc.config.li2'), t('guide.doc.config.li3'), t('guide.doc.config.li4')]} />
            <DocCallout variant="note">{t('guide.doc.config.callout')}</DocCallout>
          </DocSection>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* 13. Observability                                              */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <DocSection id="guide-observability" eyebrow={t('guide.doc.observe.eyebrow')} title={t('guide.doc.observe.title')}>
            <DocParagraph text={t('guide.doc.observe.lead')} />
            <DocList items={[t('guide.doc.observe.li1'), t('guide.doc.observe.li2'), t('guide.doc.observe.li3'), t('guide.doc.observe.li4'), t('guide.doc.observe.li5')]} />
            <DocCallout variant="note">
              <span className="text-[12px]">
                <strong>S6 trace viewer</strong> is iteration-grouped (visible in <a className="text-teal-700 underline" href="/ops/chats">/ops/chats</a>). Each iteration shows tool calls, policy hits, retries, and sub-agent dispatches in order. Filter by event class via the top bar.
              </span>
            </DocCallout>
          </DocSection>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* 14. Console pages map                                          */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <DocSection id="guide-admin-map" eyebrow={t('guide.doc.admin.eyebrow')} title={t('guide.doc.admin.title')}>
            <DocParagraph text={t('guide.doc.admin.lead')} />
            <div className="!mt-6 grid gap-4 md:grid-cols-2">
              {ADMIN_KEYS.map((key) => (
                <div key={key} className="rounded-xl border border-black/[0.06] bg-gradient-to-br from-white/55 to-[var(--void)]/30 p-4 shadow-[var(--shadow-card)] backdrop-blur-md">
                  <h3 className="text-[13px] font-semibold text-[var(--mist)]">{t(`guide.doc.admin.${key}Title`)}</h3>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--fog)]">{t(`guide.doc.admin.${key}Body`)}</p>
                </div>
              ))}
            </div>
          </DocSection>

          {/* Footer */}
          <p className="border-t border-black/[0.05] pt-10 text-center text-[12px] leading-relaxed text-[var(--smoke)]/80">{t('guide.footer.note')}</p>
        </main>
      </div>
    </div>
  )
}

// Touch unused i18n key references so a future i18n linter (if added) doesn't
// flag them — kept here intentionally as the Concepts section now hardcodes
// English copy.
void CONCEPT_KEYS
