// apps/chat/app/livechat-widget/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import type { WidgetPayload, StatusTrackStep, InteractionOption, FormField } from '@/lib/livechat/types'

// ── Types ────────────────────────────────────────────────────────────────────

type ViewKind = 'idle' | 'status_track' | 'propose_interaction' | 'request_user_input' | 'skill_render' | 'submitted'

interface FormFieldSpec {
  id: string; type: string; label: string; required?: boolean; options?: string[]; placeholder?: string
}

interface AppState {
  view: ViewKind
  caseId: string
  chatId: string
  steps: StatusTrackStep[]
  options: InteractionOption[]
  fields: FormField[]
  template: string
  renderData: unknown
}

const INITIAL_STATE: AppState = {
  view: 'idle',
  caseId: '',
  chatId: '',
  steps: [],
  options: [],
  fields: [],
  template: '',
  renderData: null,
}

// ── LiveChat SDK bridge ───────────────────────────────────────────────────────

declare global {
  interface Window {
    LiveChatWidget?: {
      on: (event: string, cb: (data: unknown) => void) => void
      call: (action: string, payload?: unknown) => void
    }
    onMomentAsyncInit?: (createMomentsSDK: (opts: { title?: string; icon?: string }) => Promise<MomentsSdkInstance>) => void
  }
}

interface MomentsSdkInstance {
  sendMessage: (msg: { text: string }) => Promise<void>
  sendSystemMessage: (msg: { text: string; recipients?: string }) => Promise<void>
  close: () => void
  setAttributes: (attrs: Record<string, unknown>) => Promise<void>
}

let momentsSdkPromise: Promise<MomentsSdkInstance | null> | null = null

/** Get Moments SDK instance. Returns null if SDK is not available (not in a Moment context). */
function getMomentsSDK(): Promise<MomentsSdkInstance | null> {
  if (momentsSdkPromise) return momentsSdkPromise

  momentsSdkPromise = new Promise<MomentsSdkInstance | null>((resolve) => {
    const done = (sdk: MomentsSdkInstance | null) => { resolve(sdk) }

    // Timeout: if SDK doesn't init within 8s, we're not in a Moment
    const timeout = setTimeout(() => {
      console.warn('[Widget] Moments SDK init timed out — not in Moment context')
      done(null)
    }, 8000)

    // BUG-F fix: use the official onMomentAsyncInit callback (not polling window.createMomentsSDK)
    window.onMomentAsyncInit = function (createMomentsSDK) {
      clearTimeout(timeout)
      createMomentsSDK({ title: 'Intera' }).then((sdk) => {
        console.log('[Widget] Moments SDK initialized')
        done(sdk)
      }).catch((e) => {
        console.error('[Widget] Moments SDK init failed:', e)
        done(null)
      })
    }

    // Also try loading the UMD script (sets up onMomentAsyncInit if not already present)
    const script = document.createElement('script')
    script.src = 'https://cdn.livechat-static.com/moments-sdk/moments-sdk-1.9.0.umd.min.js'
    script.onerror = () => {
      console.warn('[Widget] Moments SDK script failed to load')
      // Don't resolve yet — the timeout will handle it
    }
    document.head.appendChild(script)
  })

  return momentsSdkPromise
}

function isWidgetIframe(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('view')
}

async function sendToLiveChat(type: string, properties: Record<string, unknown>) {
  if (isWidgetIframe()) {
    try {
      const sdk = await getMomentsSDK()
      if (!sdk) {
        // Not in Moment context — no SDK available. The UI will show a success state
        // and auto-close via the fallback timeout in handleViewComplete.
        console.warn('[Widget] No Moments SDK — cannot send to chat')
        return
      }
      if (type === 'intera_form_submit') {
        const answers = properties.answers as Record<string, string> ?? {}
        const lines = Object.entries(answers)
          .filter(([, v]) => v.trim())
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ')
        if (lines) {
          await sdk.sendMessage({ text: lines })
        }
      } else if (type === 'intera_interaction_submit') {
        await sdk.sendMessage({ text: `${properties.optionId as string}` })
      }
      sdk.close()
    } catch (e) {
      console.error('[Widget] Moments SDK send failed:', e)
    }
    return
  }
  window.LiveChatWidget?.call('send_event', { type, properties })
}

// ── StatusTrack View ─────────────────────────────────────────────────────────

function StatusTrack({ steps }: { steps: StatusTrackStep[] }) {
  return (
    <div className="p-3 space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-indigo-400 font-semibold mb-3">
        Intera Processing
      </p>
      <AnimatePresence initial={false}>
        {steps.map((step) => (
          <motion.div
            key={step.id + step.state}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="flex items-center gap-2.5 bg-white/70 backdrop-blur-sm border border-indigo-100 rounded-xl px-3 py-2 shadow-sm"
          >
            {step.state === 'running' ? (
              <div className="w-3 h-3 rounded-full border-2 border-indigo-200 border-t-indigo-500 animate-spin flex-shrink-0" />
            ) : (
              <div className="w-3 h-3 rounded-full border-2 border-emerald-300 bg-emerald-50 flex items-center justify-center flex-shrink-0">
                <svg className="w-2 h-2 text-emerald-500" viewBox="0 0 8 8" fill="none">
                  <path d="M1 4l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className={`text-[12px] font-medium truncate ${step.state === 'done' ? 'text-gray-700' : 'text-gray-900'}`}>
                {step.label}
              </p>
            </div>
            {step.state === 'done' && step.durationMs != null && (
              <span className="text-[10px] text-emerald-400 flex-shrink-0">
                {(step.durationMs / 1000).toFixed(1)}s
              </span>
            )}
            {step.state === 'running' && (
              <span className="text-[10px] text-indigo-400 flex-shrink-0">Running</span>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

// ── OptionList View ──────────────────────────────────────────────────────────

function OptionList({
  caseId,
  options,
  onSubmit,
}: {
  caseId: string
  options: InteractionOption[]
  onSubmit: () => void
}) {
  const [textInputs, setTextInputs] = useState<Record<string, string>>({})

  const handleSelect = (opt: InteractionOption) => {
    const input = opt.inputType === 'text' ? (textInputs[opt.id] ?? '') : undefined
    sendToLiveChat('intera_interaction_submit', { caseId, optionId: opt.id, input })
    onSubmit()
  }

  return (
    <div className="p-3 space-y-2">
      {options.map((opt) => (
        <div key={opt.id} className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
          <button
            onClick={() => opt.inputType !== 'text' && handleSelect(opt)}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-gray-800 truncate">{opt.label}</p>
              {opt.description && (
                <p className="text-[11px] text-gray-400 truncate">{opt.description}</p>
              )}
            </div>
            <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          {opt.inputType === 'text' && (
            <div className="px-3 pb-2.5 space-y-2 border-t border-gray-50">
              <input
                type="text"
                placeholder={opt.inputPlaceholder ?? 'Enter...'}
                value={textInputs[opt.id] ?? ''}
                onChange={(e) => setTextInputs(prev => ({ ...prev, [opt.id]: e.target.value }))}
                className="w-full px-2.5 py-1.5 text-[12px] border border-gray-200 rounded-lg outline-none focus:border-indigo-300"
              />
              <button
                onClick={() => handleSelect(opt)}
                disabled={!(textInputs[opt.id] ?? '').trim()}
                className="w-full py-1.5 text-[12px] font-semibold text-white bg-indigo-500 rounded-lg disabled:opacity-40"
              >
                Submit
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── FormCard View ────────────────────────────────────────────────────────────

function FormCard({
  caseId,
  fields,
  onSubmit,
  onSubmitWithForm,
}: {
  caseId: string
  fields: FormField[]
  onSubmit: () => void
  onSubmitWithForm?: (answers: Record<string, string>) => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [flipped, setFlipped] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const set = (id: string, val: string) => setValues(prev => ({ ...prev, [id]: val }))

  const handleSubmit = async () => {
    setSubmitting(true)
    setFlipped(true)
    await new Promise(r => setTimeout(r, 350)) // wait for flip animation
    if (onSubmitWithForm) {
      // Parent manages the post-submit UI (success / error / retry).
      onSubmitWithForm(values)
    } else {
      sendToLiveChat('intera_form_submit', { caseId, answers: values })
      onSubmit()
    }
  }

  const isValid = fields.every(f => !f.required || (values[f.id] ?? '').trim())

  return (
    <div className="p-3" style={{ perspective: '600px' }}>
      <div
        className="relative transition-transform duration-500"
        style={{ transformStyle: 'preserve-3d', transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' } as React.CSSProperties}
      >
        {/* Front */}
        <div
          className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 space-y-3"
          style={{ backfaceVisibility: 'hidden' } as React.CSSProperties}
        >
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Please fill in</p>
          {fields.map((field) => (
            <div key={field.id} className="space-y-1">
              <label className="block text-[12px] font-medium text-gray-700">
                {field.label}{field.required && <span className="text-red-400 ml-0.5">*</span>}
              </label>
              {field.type === 'select' ? (
                <select
                  value={values[field.id] ?? ''}
                  onChange={(e) => set(field.id, e.target.value)}
                  className="w-full px-2.5 py-1.5 text-[12px] border border-gray-200 rounded-lg bg-white"
                >
                  <option value="">Select...</option>
                  {(field.options ?? []).map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : field.type === 'textarea' ? (
                <textarea
                  rows={3}
                  placeholder={field.placeholder}
                  value={values[field.id] ?? ''}
                  onChange={(e) => set(field.id, e.target.value)}
                  className="w-full px-2.5 py-1.5 text-[12px] border border-gray-200 rounded-lg resize-none"
                />
              ) : (
                <input
                  type={field.type === 'file' ? 'file' : field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
                  placeholder={field.placeholder}
                  value={field.type === 'file' ? undefined : (values[field.id] ?? '')}
                  onChange={(e) => set(field.id, field.type === 'file' ? (e.target.files?.[0]?.name ?? '') : e.target.value)}
                  className="w-full px-2.5 py-1.5 text-[12px] border border-gray-200 rounded-lg"
                />
              )}
            </div>
          ))}
          <button
            onClick={() => { void handleSubmit() }}
            disabled={!isValid || submitting}
            className="w-full py-2 text-[13px] font-semibold text-white bg-indigo-500 rounded-xl disabled:opacity-40"
          >
            Submit
          </button>
        </div>

        {/* Back (success state) */}
        <div
          className="absolute inset-0 bg-emerald-50 border border-emerald-100 rounded-xl flex flex-col items-center justify-center gap-2 text-emerald-600"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' } as React.CSSProperties}
        >
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-[13px] font-semibold">Submitted, please wait...</p>
        </div>
      </div>
    </div>
  )
}

// ── SkillRender View ─────────────────────────────────────────────────────────

function SkillRender({
  template,
  data,
  caseId,
  onSubmit,
}: {
  template: string
  data: unknown
  caseId: string
  onSubmit: () => void
}) {
  const handleAction = (id: string) => {
    sendToLiveChat('intera_interaction_submit', { caseId, optionId: id })
    onSubmit()
  }

  switch (template) {
    case 'order_timeline':
      return <OrderTimeline data={data} onAction={handleAction} />
    case 'kyc_status':
      return <KycStatus data={data} onAction={handleAction} />
    case 'game_list':
      return <GameList data={data} caseId={caseId} onSelect={(gameId: string) => {
        sendToLiveChat('intera_interaction_submit', { caseId, optionId: `pick_game:${gameId}` })
        onSubmit()
      }} />
    default:
      return (
        <div className="p-3">
          <pre className="text-[11px] p-3 bg-black/[0.03] rounded-lg border border-[var(--border-subtle)] overflow-auto max-h-[300px] whitespace-pre-wrap">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )
  }
}

function OrderTimeline({ data, onAction }: { data: unknown; onAction: (id: string) => void }) {
  const steps = Array.isArray(data) ? data : (data as Record<string, unknown>)?.steps as unknown[]
  if (!Array.isArray(steps)) {
    return <pre className="text-[11px] p-3">{JSON.stringify(data, null, 2)}</pre>
  }
  return (
    <div className="p-3 space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-indigo-400 font-semibold mb-3">Order Timeline</p>
      {steps.map((step: unknown, i: number) => {
        const s = step as Record<string, unknown>
        return (
          <div key={i} className="flex items-start gap-3 bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
            <div className="w-2 h-2 mt-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-gray-800">{String(s.label ?? s.status ?? `Step ${i + 1}`)}</p>
              <p className="text-[10px] text-gray-400">{String(s.timestamp ?? s.time ?? '')}</p>
            </div>
            {(s.actionId as string | undefined) && (
              <button onClick={() => onAction(String(s.actionId))} className="text-[10px] text-indigo-500 font-medium flex-shrink-0">
                Detail
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function KycStatus({ data, onAction }: { data: unknown; onAction: (id: string) => void }) {
  const d = data as Record<string, unknown> | undefined
  return (
    <div className="p-4 space-y-3">
      <p className="text-[10px] uppercase tracking-widest text-indigo-400 font-semibold">KYC Status</p>
      <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-[12px] text-gray-500">Status</span>
          <span className={`text-[12px] font-semibold ${d?.status === 'verified' ? 'text-emerald-500' : d?.status === 'rejected' ? 'text-red-500' : 'text-amber-500'}`}>
            {String(d?.status ?? 'pending')}
          </span>
        </div>
        {(d?.level as string | undefined) && (
          <div className="flex justify-between items-center">
            <span className="text-[12px] text-gray-500">Level</span>
            <span className="text-[12px] font-semibold text-gray-700">{String(d?.level)}</span>
          </div>
        )}
        {(d?.actionId as string | undefined) && (
          <button onClick={() => onAction(String(d?.actionId))} className="w-full py-2 text-[12px] font-semibold text-white bg-indigo-500 rounded-xl">
            Retry Verification
          </button>
        )}
      </div>
    </div>
  )
}

function GameList({ data, caseId, onSelect }: { data: unknown; caseId: string; onSelect: (id: string) => void }) {
  const items = Array.isArray(data) ? data : (data as Record<string, unknown>)?.items as unknown[]
  if (!Array.isArray(items)) {
    return <pre className="text-[11px] p-3">{JSON.stringify(data, null, 2)}</pre>
  }
  return (
    <div className="p-3 space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-indigo-400 font-semibold mb-3">Select Game</p>
      {items.map((item: unknown, i: number) => {
        const g = item as Record<string, unknown>
        const id = String(g.id ?? i)
        return (
          <button key={i} onClick={() => onSelect(id)} className="w-full flex items-center gap-3 bg-white border border-gray-100 rounded-xl p-3 shadow-sm hover:bg-gray-50 transition-colors text-left">
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-gray-800 truncate">{String(g.name ?? g.title ?? id)}</p>
              {(g.description as string | undefined) && <p className="text-[11px] text-gray-400 truncate">{String(g.description)}</p>}
            </div>
            <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )
      })}
    </div>
  )
}

// ── Main App ─────────────────────────────────────────────────────────────────

export default function LiveChatWidget() {
  const [state, setState] = useState<AppState>(INITIAL_STATE)
  const [isOnline, setIsOnline] = useState(true)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [formAttempt, setFormAttempt] = useState(0)
  const isPreview = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('preview')

  // Online/offline detection
  useEffect(() => {
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  // Eagerly initialize the Moments SDK as soon as the webview mounts.
  // The Moment host fires window.onMomentAsyncInit at page load, so the handler
  // MUST be registered before submit — otherwise a lazy (on-submit) init can miss
  // the callback and the Moment won't auto-close. Memoized, so submit reuses it.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!isWidgetIframe()) return
    void getMomentsSDK()
  }, [])

  // URL-param form mode — when opened as Moments webview from a form_request card
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('view') !== 'form') return
    try {
      const fieldsJson = params.get('fields')
      const fields = fieldsJson ? JSON.parse(fieldsJson) as FormFieldSpec[] : []
      const caseId = params.get('caseId') ?? ''
      const chatId = params.get('chatId') ?? ''
      const title = params.get('title') ?? 'Form'
      setState({
        view: 'request_user_input',
        caseId,
        chatId,
        steps: [],
        options: [],
        fields: fields.map(f => ({ id: f.id, type: f.type as FormField['type'], label: f.label, required: f.required, options: f.options, placeholder: f.placeholder })),
        template: title,
        renderData: null,
      })
    } catch { /* invalid params */ }
  }, [])

  useEffect(() => {
    // Listen for intera_widget_payload events from Bridge (LiveChat SDK)
    window.LiveChatWidget?.on('new_event', (raw: unknown) => {
      const data = raw as { type?: string; content?: WidgetPayload }
      if (data?.type !== 'intera_widget_payload' || !data.content) return
      processPayload(data.content)
    })

    // Dual-mode: listen for postMessage preview events (Console iframe)
    if (isPreview || !window.LiveChatWidget) {
      const onMessage = (event: MessageEvent) => {
        if (event.data?.type === 'intera_widget_preview' && event.data.payload) {
          processPayload(event.data.payload as WidgetPayload)
        }
      }
      window.addEventListener('message', onMessage)
      return () => window.removeEventListener('message', onMessage)
    }
  }, [isPreview])

  function processPayload(payload: WidgetPayload) {
    setState(prev => {
      switch (payload.kind) {
        case 'status_track': {
          const step = payload.step
          if (!step) return prev
          const existingIdx = prev.steps.findIndex(s => s.id === step.id)
          const steps = existingIdx >= 0
            ? prev.steps.map((s, i) => i === existingIdx ? step : s)
            : [...prev.steps, step]
          return { ...prev, view: 'status_track', caseId: payload.caseId, steps }
        }
        case 'propose_interaction':
          return { ...prev, view: 'propose_interaction', caseId: payload.caseId, options: payload.options ?? [], steps: [] }
        case 'request_user_input':
          return { ...prev, view: 'request_user_input', caseId: payload.caseId, fields: payload.fields ?? [], steps: [] }
        case 'skill_render':
          return { ...prev, view: 'skill_render', caseId: payload.caseId, template: payload.template ?? '', renderData: payload.data }
        default:
          return prev
      }
    })
  }

  const handleViewComplete = useCallback(() => {
    if (isWidgetIframe()) {
      // BUG-F: always close the webview after form/interaction, even if SDK isn't available
      getMomentsSDK().then((sdk) => {
        if (sdk) setTimeout(() => sdk.close(), 300)
      })
    }
    setState(INITIAL_STATE)
  }, [])

  // BUG-F fix: deliver form answers via our own backend (SDK-independent).
  // The webview is served from our domain, so it can POST straight to
  // /api/livechat/form-submit, which drives the bridge → agent → LiveChat reply.
  // The Moments SDK (only present in real Moments, NOT plain webview buttons)
  // is used best-effort just to auto-close the webview.
  const handleFormSubmit = useCallback((answers: Record<string, string>) => {
    const cleaned: Record<string, string> = {}
    for (const [k, v] of Object.entries(answers)) {
      if (typeof v === 'string' && v.trim()) cleaned[k] = v.trim()
    }
    const params = new URLSearchParams(window.location.search)
    const chatId = params.get('chatId') ?? state.chatId
    const caseId = params.get('caseId') ?? state.caseId

    if (!chatId || Object.keys(cleaned).length === 0) {
      // No delivery channel (e.g. Console preview) — just acknowledge locally.
      setState(prev => ({ ...prev, view: 'submitted' }))
      return
    }

    setSubmitError(null)
    fetch('/api/livechat/form-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, caseId, answers: cleaned }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`form-submit HTTP ${res.status}`)
        setState(prev => ({ ...prev, view: 'submitted' }))
        // Auto-close the Moment for a smooth UX (SDK was pre-initialized on mount).
        // Falls back to the 'submitted' screen if not in a Moment (no SDK).
        getMomentsSDK().then((sdk) => { if (sdk) setTimeout(() => sdk.close(), 300) })
      })
      .catch((err) => {
        console.error('[Widget] form submit failed:', err)
        setSubmitError('提交失败，请重试，或直接在聊天里发送该信息。')
        // Remount the form (fresh, un-flipped) so the user can retry.
        setFormAttempt((n) => n + 1)
      })
  }, [state.chatId, state.caseId])

  if (state.view === 'idle') {
    return (
      <div className="font-sans bg-gray-50 min-h-screen flex items-center justify-center">
        <p className="text-[11px] text-gray-400">Intera preparing...</p>
      </div>
    )
  }

  return (
    <div className="font-sans bg-gray-50 min-h-screen">
      {!isOnline && (
        <div className="bg-red-500 text-white text-[10px] text-center py-1 px-2">
          Connection lost — waiting for network...
        </div>
      )}
      {submitError && (
        <div className="bg-amber-500 text-white text-[10px] text-center py-1 px-2 flex justify-between items-center">
          <span>{submitError}</span>
          <button onClick={() => setSubmitError(null)} className="text-white ml-2">&times;</button>
        </div>
      )}
      <AnimatePresence mode="wait">
        {state.view === 'status_track' && (
          <motion.div key="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <StatusTrack steps={state.steps} />
          </motion.div>
        )}
        {state.view === 'propose_interaction' && (
          <motion.div key="options" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <OptionList caseId={state.caseId} options={state.options} onSubmit={handleViewComplete} />
          </motion.div>
        )}
        {state.view === 'request_user_input' && (
          <motion.div key="form" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <FormCard key={`form-${formAttempt}`} caseId={state.caseId} fields={state.fields} onSubmit={handleViewComplete} onSubmitWithForm={isWidgetIframe() ? handleFormSubmit : undefined} />
          </motion.div>
        )}
        {state.view === 'submitted' && (
          <motion.div key="submitted" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="p-3">
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-5 flex flex-col items-center justify-center gap-2 text-emerald-600">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-[13px] font-semibold">已提交</p>
                <p className="text-[11px] text-emerald-500/80 text-center">请返回聊天窗口查看回复，可关闭此页面。</p>
              </div>
            </div>
          </motion.div>
        )}
        {state.view === 'skill_render' && (
          <motion.div key="skill" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <SkillRender template={state.template} data={state.renderData} caseId={state.caseId} onSubmit={handleViewComplete} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
