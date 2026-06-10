'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardList,
  FileDiff,
  Loader2,
  LockKeyhole,
  Play,
  RefreshCw,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  XCircle,
} from 'lucide-react'
import VersionContextBar, { useSelectedAgentId } from '@/components/admin/version-context-bar'
import ConfigDiffViewer from '@/components/config-diff/config-diff-viewer'
import { OrganicLoader, TokenStreamPreview } from '@/components/config-pilot/ai-motion'
import { ReceiptStatusIcon, ScenarioReceiptPanel } from '@/components/scenario-receipts/scenario-receipt-panel'
import { apiClient, ApiClientError } from '@/lib/api/client'
import type {
  ConfigPilotApplyResponse,
  ConfigPilotContextResponse,
  ConfigPilotPatch,
  ConfigPilotProposal,
  ConfigPilotProposeResponse,
} from '@/lib/config-pilot/contracts'
import type { SavedScenario, ScenarioObservedEvidenceInput, ScenarioReceipt, ScenarioValidationSummary } from '@intera/shared/contracts/scenarios'
import PlaygroundPage from '@/app/admin/playground/page'

interface ScenarioListResponse {
  scenarios: SavedScenario[]
  receipts: ScenarioReceipt[]
  validation: ScenarioValidationSummary
}

interface ChatMessage {
  id: string
  role: 'pilot' | 'user' | 'system'
  content: string
  streaming?: boolean
  tone?: 'normal' | 'success' | 'warning' | 'danger'
}

type ProposalPhase = 'idle' | 'proposing' | 'proposal' | 'diff' | 'accepted' | 'applying' | 'applied'

const PILOT_GREETING = '我已读取当前 draft。你可以让我创建流程、修改 prompt、添加 hook、运行 scenario，或检查发布前风险。'
const DEFAULT_PROMPT = 'Create a repeatable deposit handoff Scenario with tool evidence, Hook escalation, human transfer, and forbidden compensation wording.'
const DEFAULT_OBSERVED = JSON.stringify({
  knowledgeHits: [{ source: 'fixture', title: 'Deposit runbook' }],
}, null, 2)

let messageCounter = 0
function nextMessageId(prefix: string) {
  messageCounter += 1
  return `${prefix}-${messageCounter}`
}

export default function PilotLabPage() {
  const searchParams = useSearchParams()
  const activeTab = searchParams.get('tab') === 'playground' ? 'playground' : 'pilot'
  const agentConfigId = useSelectedAgentId()
  const chatEndRef = useRef<HTMLDivElement | null>(null)
  const [context, setContext] = useState<ConfigPilotContextResponse | null>(null)
  const [scenarios, setScenarios] = useState<SavedScenario[]>([])
  const [receipts, setReceipts] = useState<ScenarioReceipt[]>([])
  const [validation, setValidation] = useState<ScenarioValidationSummary | null>(null)
  const [selectedScenarioName, setSelectedScenarioName] = useState<string | null>(null)
  const [selectedReceiptRunId, setSelectedReceiptRunId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [composer, setComposer] = useState('')
  const [proposal, setProposal] = useState<ConfigPilotProposal | null>(null)
  const [proposalPhase, setProposalPhase] = useState<ProposalPhase>('idle')
  const [accepted, setAccepted] = useState(false)
  const [modelUsed, setModelUsed] = useState<string | null>(null)
  const [promptVersion, setPromptVersion] = useState<string | null>(null)
  const [observedJson, setObservedJson] = useState(DEFAULT_OBSERVED)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const selectedScenario = useMemo(
    () => scenarios.find((scenario) => scenario.name === selectedScenarioName) ?? scenarios[0] ?? null,
    [scenarios, selectedScenarioName],
  )
  const selectedReceipt = useMemo(
    () => receipts.find((receipt) => receipt.runId === selectedReceiptRunId) ?? receipts[0] ?? null,
    [receipts, selectedReceiptRunId],
  )
  const latestRuntimeReceipt = receipts.find((receipt) => receipt.executionMode === 'agentRuntime') ?? null
  const latestFixtureReceipt = receipts.find((receipt) => receipt.executionMode === 'fixture') ?? null
  const canApply = Boolean(context?.permissions.canApply && proposal && accepted && proposalPhase === 'accepted')
  const diffGroups = proposal?.diffGroups ?? []

  const addMessage = useCallback((message: Omit<ChatMessage, 'id'> & { id?: string }) => {
    setMessages((prev) => [...prev, { ...message, id: message.id ?? nextMessageId(message.role) }])
  }, [])

  const loadScenarios = useCallback(async (id: string) => {
    const result = await apiClient<ScenarioListResponse>(`/api/admin/scenarios?agentConfigId=${encodeURIComponent(id)}`)
    const data = result.data
    setScenarios(data.scenarios)
    setReceipts(data.receipts)
    setValidation(data.validation)
    setSelectedScenarioName((prev) => {
      if (prev && data.scenarios.some((scenario) => scenario.name === prev)) return prev
      return data.scenarios[0]?.name ?? null
    })
    setSelectedReceiptRunId((prev) => {
      if (prev && data.receipts.some((receipt) => receipt.runId === prev)) return prev
      return data.receipts[0]?.runId ?? null
    })
  }, [])

  const loadCockpit = useCallback(async () => {
    if (!agentConfigId) return
    setLoading(true)
    setError(null)
    try {
      const contextResult = await apiClient<ConfigPilotContextResponse>(`/api/admin/config-pilot/context?agentConfigId=${encodeURIComponent(agentConfigId)}`)
      setContext(contextResult.data)
      setValidation(contextResult.data.validation)
      setMessages([
        {
          id: 'pilot-greeting',
          role: 'pilot',
          content: PILOT_GREETING,
          streaming: true,
        },
      ])
      await loadScenarios(agentConfigId)
    } catch (err) {
      setError(err instanceof ApiClientError ? err.envelope.error.message : 'Failed to load Pilot cockpit')
      setMessages([
        {
          id: 'pilot-greeting-error',
          role: 'pilot',
          tone: 'danger',
          content: 'I could not read the current draft context. Refresh or select another Agent version.',
        },
      ])
    } finally {
      setLoading(false)
    }
  }, [agentConfigId, loadScenarios])

  useEffect(() => { loadCockpit() }, [loadCockpit])

  useEffect(() => {
    if (!messages.some((message) => message.streaming)) return
    const timer = window.setTimeout(() => {
      setMessages((prev) => prev.map((message) => ({ ...message, streaming: false })))
    }, 900)
    return () => window.clearTimeout(timer)
  }, [messages])

  useEffect(() => {
    if (typeof chatEndRef.current?.scrollIntoView === 'function') {
      chatEndRef.current.scrollIntoView({ block: 'end' })
    }
  }, [messages, proposalPhase])

  const proposeFromPrompt = useCallback(async (request: string) => {
    if (!agentConfigId || !request.trim()) return
    setError(null)
    setNotice(null)
    setProposal(null)
    setAccepted(false)
    setProposalPhase('proposing')
    try {
      const result = await apiClient<ConfigPilotProposeResponse>('/api/admin/config-pilot/propose', {
        method: 'POST',
        body: { agentConfigId, request },
      })
      setProposal(result.data.proposal)
      setModelUsed(result.data.modelUsed)
      setPromptVersion(result.data.promptVersion)
      setProposalPhase('proposal')
      addMessage({
        role: 'pilot',
        content: `I drafted a typed proposal: ${result.data.proposal.title}. Review the right panel diff before accepting.`,
        streaming: true,
      })
    } catch (err) {
      setProposalPhase('idle')
      setError(err instanceof ApiClientError ? err.envelope.error.message : 'Failed to generate ConfigPilot proposal')
      addMessage({
        role: 'pilot',
        tone: 'danger',
        content: 'ConfigPilot could not create a typed proposal. The draft was not changed.',
      })
    }
  }, [addMessage, agentConfigId])

  const sendComposer = useCallback(async () => {
    const request = composer.trim()
    if (!request) return
    setComposer('')
    addMessage({ role: 'user', content: request })
    await proposeFromPrompt(request)
  }, [addMessage, composer, proposeFromPrompt])

  const reviewDiff = useCallback(() => {
    if (!proposal) return
    setProposalPhase('diff')
    setAccepted(false)
    setNotice(null)
    addMessage({
      role: 'pilot',
      content: 'Diff is open in the control panel. Apply remains disabled until you explicitly accept it.',
    })
  }, [addMessage, proposal])

  const rejectProposal = useCallback(() => {
    setProposal(null)
    setAccepted(false)
    setProposalPhase('idle')
    setNotice('Proposal rejected. No draft changes were written.')
    addMessage({
      role: 'pilot',
      tone: 'warning',
      content: 'Rejected. Nothing was saved to the draft.',
    })
  }, [addMessage])

  const acceptProposal = useCallback((checked: boolean) => {
    setAccepted(checked)
    if (checked && proposalPhase === 'diff') {
      setProposalPhase('accepted')
      addMessage({
        role: 'system',
        tone: 'success',
        content: 'Human accept recorded. The apply action is now available.',
      })
    }
    if (!checked && proposalPhase === 'accepted') setProposalPhase('diff')
  }, [addMessage, proposalPhase])

  const applyProposal = useCallback(async () => {
    if (!agentConfigId || !proposal || !accepted || proposalPhase !== 'accepted') return
    setProposalPhase('applying')
    setError(null)
    setNotice(null)
    try {
      const result = await apiClient<ConfigPilotApplyResponse>('/api/admin/config-pilot/apply', {
        method: 'POST',
        body: { agentConfigId, accepted: true, proposal },
      })
      setProposalPhase('applied')
      setValidation(result.data.validation)
      setNotice(`Applied ${result.data.appliedPatches.length} draft ${result.data.appliedPatches.length === 1 ? 'change' : 'changes'}. Validation is now ${result.data.validation.state}.`)
      addMessage({
        role: 'pilot',
        tone: 'success',
        content: `Draft saved through typed APIs. Validation is now ${result.data.validation.state}; run a runtime-backed Scenario before publishing.`,
        streaming: true,
      })
      await loadScenarios(result.data.draftAgentConfigId)
      const contextResult = await apiClient<ConfigPilotContextResponse>(`/api/admin/config-pilot/context?agentConfigId=${encodeURIComponent(result.data.draftAgentConfigId)}`)
      setContext(contextResult.data)
    } catch (err) {
      setProposalPhase('accepted')
      setError(err instanceof ApiClientError ? err.envelope.error.message : 'Failed to apply accepted draft')
      addMessage({
        role: 'pilot',
        tone: 'danger',
        content: 'Apply failed. The accepted proposal remains available, but no publish or activation action was called.',
      })
    }
  }, [accepted, addMessage, agentConfigId, loadScenarios, proposal, proposalPhase])

  const runSelectedScenario = useCallback(async (executionMode: 'fixture' | 'agentRuntime') => {
    if (!agentConfigId || !selectedScenario) return
    setRunning(true)
    setError(null)
    setNotice(null)
    try {
      let observed: ScenarioObservedEvidenceInput | undefined
      if (executionMode === 'fixture' && observedJson.trim()) {
        observed = JSON.parse(observedJson) as ScenarioObservedEvidenceInput
      }
      const result = await apiClient<{ receipt: ScenarioReceipt; validation: ScenarioValidationSummary }>(
        `/api/admin/scenarios/${encodeURIComponent(selectedScenario.name)}/run`,
        { method: 'POST', body: { agentConfigId, executionMode, observed } },
      )
      setReceipts((prev) => [result.data.receipt, ...prev.filter((receipt) => receipt.runId !== result.data.receipt.runId)])
      setSelectedReceiptRunId(result.data.receipt.runId)
      setValidation(result.data.validation)
      addMessage({
        role: 'pilot',
        tone: result.data.receipt.status === 'pass' ? 'success' : 'warning',
        content: `${executionMode === 'agentRuntime' ? 'Runtime-backed' : 'Fixture-only'} Scenario run finished: ${result.data.receipt.status}.`,
        streaming: true,
      })
    } catch (err) {
      setError(err instanceof SyntaxError ? `Invalid observed evidence JSON: ${err.message}` : err instanceof ApiClientError ? err.envelope.error.message : 'Failed to run Scenario')
    } finally {
      setRunning(false)
    }
  }, [addMessage, agentConfigId, observedJson, selectedScenario])

  if (activeTab === 'playground') {
    return (
      <div className="intera-q2-page flex min-h-screen flex-col overflow-hidden px-4 py-4 text-[var(--color-text-primary)] sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-0 w-full max-w-[1580px] flex-1 flex-col gap-4">
          <VersionContextBar />
          <section className="intera-q2-panel overflow-hidden">
            <div className="flex flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium text-[var(--color-text-tertiary)]">
                  <span>Build</span>
                  <span className="text-[var(--color-border-strong)]">/</span>
                  <span>Pilot Lab</span>
                  <span className="text-[var(--color-border-strong)]">/</span>
                  <span className="text-[var(--color-text-primary)]">Playground</span>
                </div>
                <h1 className="mt-2 text-[24px] font-semibold leading-tight text-[var(--color-text-primary)] sm:text-[28px]">Playground compatibility surface</h1>
                <p className="mt-2 max-w-3xl text-[14px] leading-6 text-[var(--color-text-secondary)]">
                  Keep manual dry-run, trace inspection, and debugging flows inside Pilot Lab without restoring Playground to the global navigation.
                </p>
              </div>
              <span className="inline-flex items-center rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/78 px-3 py-1.5 text-[12px] font-semibold text-[var(--color-text-secondary)]">
                Compatibility route only
              </span>
            </div>
          </section>
          <PilotLabTabs activeTab="playground" />
          <div className="intera-q2-panel min-h-0 flex-1 overflow-hidden">
            <PlaygroundPage />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="intera-q2-page min-h-screen overflow-x-hidden px-4 py-4 text-[var(--color-text-primary)] sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1580px] flex-col gap-4">
        <VersionContextBar />

        <section className="intera-q2-panel overflow-hidden">
          <div className="flex flex-col gap-4 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium text-[var(--color-text-tertiary)]">
                <span>Build</span>
                <span className="text-[var(--color-border-strong)]">/</span>
                <span className="text-[var(--color-text-primary)]">Pilot Lab</span>
                <span className="rounded-[var(--radius-control)] border border-[rgba(53,127,124,0.18)] bg-[rgba(53,127,124,0.07)] px-2 py-1 text-[var(--color-accent-primary)]">Chat Cockpit</span>
              </div>
              <h1 className="mt-3 text-[24px] font-semibold leading-tight text-[var(--color-text-primary)] sm:text-[28px]">U-Pilot Chat Cockpit</h1>
              <p className="mt-2 max-w-3xl text-[14px] leading-6 text-[var(--color-text-secondary)]">
                Draft proposals, diff review, Scenario receipts, and Playground debugging stay together inside one Build-native cockpit.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ContextBadge context={context} />
              <ValidationBadge validation={validation} />
              <button type="button" onClick={loadCockpit} className="intera-q2-button inline-flex h-9 items-center gap-2 border border-[var(--color-border-subtle)] bg-white px-3 text-[13px] font-medium hover:bg-[var(--color-bg-surface-muted)]">
                <RefreshCw size={15} /> Refresh
              </button>
            </div>
          </div>
        </section>

        <PilotLabTabs activeTab="pilot" />

        {(error || notice) && (
          <div className="grid gap-2">
            {error && <div className="rounded-[var(--radius-control)] border border-[color:color-mix(in_srgb,var(--color-signal-danger)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--color-signal-danger)_10%,white)] px-4 py-3 text-sm text-[var(--color-signal-danger)]">{error}</div>}
            {notice && <div className="rounded-[var(--radius-control)] border border-[color:color-mix(in_srgb,var(--color-signal-success)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--color-signal-success)_10%,white)] px-4 py-3 text-sm text-[var(--color-signal-success)]">{notice}</div>}
          </div>
        )}

        <div className="grid min-h-[calc(100vh-190px)] gap-4 xl:grid-cols-[minmax(0,1fr)_440px] 2xl:grid-cols-[minmax(0,1fr)_480px]">
          <main className="intera-q2-panel flex min-h-[620px] min-w-0 flex-col overflow-hidden">
            <section className="flex items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-[var(--color-text-tertiary)]">Current agent</p>
                <h2 className="truncate text-[16px] font-semibold text-[var(--color-text-primary)]">
                  {context ? `${context.selected.name} v${context.selected.version}` : 'Loading draft context'}
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {loading ? <OrganicLoader variant="02" size={22} title="Loading Pilot context" /> : <OrganicLoader variant={proposalPhase === 'proposing' ? '05' : '11'} size={22} title="Pilot status loader" />}
                <span className="hidden text-[12px] text-[var(--color-text-tertiary)] sm:inline">{proposalPhaseLabel(proposalPhase)}</span>
              </div>
            </section>

            <section className="min-h-0 flex-1 overflow-y-auto bg-[color:color-mix(in_srgb,var(--color-bg-surface-muted)_62%,white)] px-4 py-5 sm:px-6">
              <div className="mx-auto flex max-w-[860px] flex-col gap-4">
                {messages.map((message) => (
                  <ChatBubble key={message.id} message={message} />
                ))}
                {proposalPhase === 'proposing' && (
                  <ChatBubble
                    message={{
                      id: 'pilot-proposing',
                      role: 'pilot',
                      content: 'ConfigPilot is generating a typed patch proposal. The draft is not changed yet.',
                      streaming: true,
                    }}
                  />
                )}
                <QuickPromptRow disabled={!agentConfigId || proposalPhase === 'proposing'} onSelect={(prompt) => { setComposer(prompt); void proposeFromPrompt(prompt) }} />
                <div ref={chatEndRef} />
              </div>
            </section>

            <section className="sticky bottom-0 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-4 py-3 sm:px-5">
              <form
                className="mx-auto flex max-w-[920px] items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void sendComposer()
                }}
              >
                <label htmlFor="pilot-composer" className="sr-only">Message U-Pilot</label>
                <textarea
                  id="pilot-composer"
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void sendComposer()
                    }
                  }}
                  rows={2}
                  placeholder="Ask U-Pilot to create a flow, modify a prompt, add a Hook, run a Scenario, or check release risk..."
                  className="min-h-[52px] flex-1 resize-none rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-[14px] leading-5 text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent-primary)]"
                />
                <button type="submit" disabled={!composer.trim() || proposalPhase === 'proposing'} className="intera-q2-button flex h-[52px] w-[52px] shrink-0 items-center justify-center bg-[var(--color-accent-primary)] text-white disabled:opacity-50" aria-label="Send message">
                  {proposalPhase === 'proposing' ? <Loader2 size={18} className="animate-spin" /> : <SendHorizontal size={18} />}
                </button>
              </form>
            </section>
          </main>

          <ControlPanel
            context={context}
            scenarios={scenarios}
            selectedScenario={selectedScenario}
            setSelectedScenarioName={setSelectedScenarioName}
            receipts={receipts}
            selectedReceipt={selectedReceipt}
            selectedReceiptRunId={selectedReceiptRunId}
            setSelectedReceiptRunId={setSelectedReceiptRunId}
            latestRuntimeReceipt={latestRuntimeReceipt}
            latestFixtureReceipt={latestFixtureReceipt}
            validation={validation}
            proposal={proposal}
            proposalPhase={proposalPhase}
            diffGroups={diffGroups}
            accepted={accepted}
            canApply={canApply}
            modelUsed={modelUsed}
            promptVersion={promptVersion}
            observedJson={observedJson}
            setObservedJson={setObservedJson}
            running={running}
            onReviewDiff={reviewDiff}
            onReject={rejectProposal}
            onAccept={acceptProposal}
            onApply={applyProposal}
            onRunScenario={runSelectedScenario}
            onUseDefaultPrompt={() => {
              setComposer(DEFAULT_PROMPT)
              void proposeFromPrompt(DEFAULT_PROMPT)
            }}
          />
        </div>
      </div>
    </div>
  )
}

function PilotLabTabs({ activeTab }: { activeTab: 'pilot' | 'playground' }) {
  const tabs = [
    { id: 'pilot' as const, href: '/build/pilot-lab', label: 'Pilot', description: 'Draft changes and Scenario receipts' },
    { id: 'playground' as const, href: '/build/pilot-lab?tab=playground', label: 'Playground', description: 'Manual dry-run and trace debug' },
  ]

  return (
    <nav className="intera-q2-panel flex flex-wrap gap-2 p-3" aria-label="Pilot Lab tabs">
      {tabs.map((tab) => {
        const active = activeTab === tab.id
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`intera-q2-button inline-flex min-h-10 items-center gap-2 border px-3 py-2 text-left text-[13px] font-semibold transition ${
              active
                ? 'border-[rgba(53,127,124,0.28)] bg-[rgba(53,127,124,0.09)] text-[var(--color-accent-primary)]'
                : 'border-[var(--color-border-subtle)] bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface-muted)]'
            }`}
          >
            <span>{tab.label}</span>
            <span className="hidden text-[11px] font-medium text-[var(--color-text-tertiary)] sm:inline">{tab.description}</span>
          </Link>
        )
      })}
    </nav>
  )
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const toneClass = message.tone === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
    : message.tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : message.tone === 'danger'
        ? 'border-red-200 bg-red-50 text-red-900'
        : isUser
          ? 'border-[rgba(53,127,124,0.20)] bg-[rgba(53,127,124,0.09)] text-[var(--color-text-primary)]'
          : 'border-[var(--color-border-subtle)] bg-white text-[var(--color-text-primary)]'
  return (
    <article className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-[rgba(53,127,124,0.18)] bg-white text-[var(--color-accent-primary)]">
          {message.role === 'system' ? <CheckCircle2 size={15} /> : <Bot size={15} />}
        </span>
      )}
      <div className={`max-w-[min(720px,100%)] rounded-[var(--radius-panel)] border px-4 py-3 text-[14px] leading-6 shadow-[0_1px_2px_rgba(21,23,25,0.04)] ${toneClass}`}>
        {message.streaming ? <TokenStreamPreview text={message.content} /> : message.content}
      </div>
    </article>
  )
}

function QuickPromptRow({ disabled, onSelect }: { disabled: boolean; onSelect: (prompt: string) => void }) {
  const prompts = [
    'Create a Procedure for deposit evidence collection and handoff.',
    'Modify the prompt so the Agent asks one clarification before using tools.',
    'Add a Hook that escalates when provider evidence conflicts.',
    'Check release risk from the latest Scenario receipt.',
  ]
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {prompts.map((prompt) => (
        <button
          key={prompt}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(prompt)}
          className="intera-q2-button min-h-11 border border-[var(--color-border-subtle)] bg-white/80 px-3 py-2 text-left text-[12px] leading-4 text-[var(--color-text-secondary)] hover:border-[rgba(53,127,124,0.28)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
        >
          {prompt}
        </button>
      ))}
    </div>
  )
}

function ControlPanel({
  context,
  scenarios,
  selectedScenario,
  setSelectedScenarioName,
  receipts,
  selectedReceipt,
  selectedReceiptRunId,
  setSelectedReceiptRunId,
  latestRuntimeReceipt,
  latestFixtureReceipt,
  validation,
  proposal,
  proposalPhase,
  diffGroups,
  accepted,
  canApply,
  modelUsed,
  promptVersion,
  observedJson,
  setObservedJson,
  running,
  onReviewDiff,
  onReject,
  onAccept,
  onApply,
  onRunScenario,
  onUseDefaultPrompt,
}: {
  context: ConfigPilotContextResponse | null
  scenarios: SavedScenario[]
  selectedScenario: SavedScenario | null
  setSelectedScenarioName: (name: string) => void
  receipts: ScenarioReceipt[]
  selectedReceipt: ScenarioReceipt | null
  selectedReceiptRunId: string | null
  setSelectedReceiptRunId: (runId: string) => void
  latestRuntimeReceipt: ScenarioReceipt | null
  latestFixtureReceipt: ScenarioReceipt | null
  validation: ScenarioValidationSummary | null
  proposal: ConfigPilotProposal | null
  proposalPhase: ProposalPhase
  diffGroups: ConfigPilotProposal['diffGroups']
  accepted: boolean
  canApply: boolean
  modelUsed: string | null
  promptVersion: string | null
  observedJson: string
  setObservedJson: (value: string) => void
  running: boolean
  onReviewDiff: () => void
  onReject: () => void
  onAccept: (checked: boolean) => void
  onApply: () => void
  onRunScenario: (executionMode: 'fixture' | 'agentRuntime') => void
  onUseDefaultPrompt: () => void
}) {
  return (
    <aside className="min-w-0 space-y-4 xl:max-h-[calc(100vh-190px)] xl:overflow-y-auto xl:pr-1">
      <section className="intera-q2-rail p-4">
        <PanelHeader icon={ClipboardList} title="Current context" eyebrow="Draft lens" />
        {context ? (
          <div className="mt-4 grid gap-2 text-[12px] leading-5 text-[var(--color-text-secondary)]">
            <ContextRow label="Selected" value={`${context.selected.name} v${context.selected.version}`} />
            <ContextRow label="Draft" value={context.draft ? `v${context.draft.version}` : 'none'} />
            <ContextRow label="Active" value={context.active ? `v${context.active.version}` : 'none'} />
            <ContextRow label="Model" value={modelUsed ?? context.selected.model} />
            <ContextRow label="Prompt" value={promptVersion ?? 'context loaded'} />
            <ContextRow label="Apply permission" value={context.permissions.canApply ? 'allowed after accept' : 'read-only'} />
          </div>
        ) : (
          <p className="mt-4 text-[13px] text-[var(--color-text-tertiary)]">Loading ConfigPilot context.</p>
        )}
      </section>

      <section className="intera-q2-panel overflow-hidden">
        <div className="border-b border-[var(--color-border-subtle)] px-4 py-3">
          <PanelHeader icon={FileDiff} title="Proposed changes" eyebrow="Accept required" />
        </div>
        <div className="grid gap-4 p-4">
          {proposal ? (
            <>
              <div>
                <p className="text-[14px] font-semibold text-[var(--color-text-primary)]">{proposal.title}</p>
                <p className="mt-1 text-[13px] leading-5 text-[var(--color-text-secondary)]">{proposal.summary}</p>
                {proposal.rationale ? <p className="mt-2 text-[12px] leading-5 text-[var(--color-text-tertiary)]">{proposal.rationale}</p> : null}
              </div>
              <ConfigPilotPatchList patches={proposal.patches} />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={onReviewDiff} className="intera-q2-button inline-flex h-9 items-center gap-2 border border-[var(--color-border-subtle)] bg-white px-3 text-[13px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface-muted)]">
                  <FileDiff size={15} /> Review diff
                </button>
                <button type="button" onClick={onReject} className="intera-q2-button inline-flex h-9 items-center gap-2 border border-red-200 bg-white px-3 text-[13px] font-medium text-red-700 hover:bg-red-50">
                  <RotateCcw size={15} /> Reject
                </button>
              </div>
            </>
          ) : proposalPhase === 'proposing' ? (
            <div className="rounded-[var(--radius-control)] border border-[rgba(53,127,124,0.18)] bg-[rgba(53,127,124,0.06)] px-3 py-3 text-[13px] text-[var(--color-text-secondary)]">
              <TokenStreamPreview text="Generating typed draft proposal." />
            </div>
          ) : (
            <div className="grid gap-3">
              <p className="text-[13px] leading-5 text-[var(--color-text-tertiary)]">No proposal yet. Start from chat or use the backend ConfigPilot default prompt.</p>
              <button type="button" onClick={onUseDefaultPrompt} className="intera-q2-button inline-flex h-9 items-center justify-center gap-2 border border-[rgba(53,127,124,0.22)] bg-[rgba(53,127,124,0.08)] px-3 text-[13px] font-medium text-[var(--color-accent-primary)]">
                <Sparkles size={15} /> Generate proposal
              </button>
            </div>
          )}
        </div>
      </section>

      {proposalPhase === 'diff' || proposalPhase === 'accepted' || proposalPhase === 'applying' || proposalPhase === 'applied' ? (
        <ConfigDiffViewer title="Diff viewer" subtitle="Review exact typed patch changes before accepting. Pilot can save draft only." groups={diffGroups} emptyLabel="No diff rows were returned." />
      ) : (
        <section className="intera-q2-panel p-4">
          <PanelHeader icon={FileDiff} title="Diff viewer" eyebrow="Waiting" />
          <div className="mt-4 rounded-[var(--radius-control)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] px-3 py-8 text-center text-[13px] text-[var(--color-text-tertiary)]">Open proposal review to inspect the diff.</div>
        </section>
      )}

      <section className="intera-q2-panel p-4">
        <div className="grid gap-3">
          <label className={`flex items-start gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-[13px] leading-5 ${proposalPhase === 'diff' || proposalPhase === 'accepted' || proposalPhase === 'applying' ? 'border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] text-[var(--color-text-secondary)]' : 'border-[var(--color-border-subtle)] bg-white text-[var(--color-text-tertiary)]'}`}>
            <input type="checkbox" checked={accepted} disabled={proposalPhase !== 'diff' && proposalPhase !== 'accepted'} onChange={(event) => onAccept(event.target.checked)} className="mt-1" />
            <span>I reviewed the diff and explicitly accept these draft configuration changes.</span>
          </label>
          <button type="button" onClick={onApply} disabled={!canApply || proposalPhase === 'applying'} className="intera-q2-button inline-flex h-10 items-center justify-center gap-2 bg-[var(--color-accent-primary)] px-4 text-[13px] font-semibold text-white disabled:opacity-50" data-testid="config-pilot-apply-draft">
            {proposalPhase === 'applying' ? <Loader2 size={15} className="animate-spin" /> : <LockKeyhole size={15} />} Apply accepted draft
          </button>
          <p className="text-[12px] leading-5 text-[var(--color-text-tertiary)]">Apply calls only `/api/admin/config-pilot/apply`, writes draft config, and marks validation stale. Publish, activate, deploy, and rollback are unavailable here.</p>
        </div>
      </section>

      <section className="intera-q2-panel overflow-hidden">
        <div className="border-b border-[var(--color-border-subtle)] px-4 py-3">
          <PanelHeader icon={Play} title="Scenario controls" eyebrow="Receipt truth" />
        </div>
        <div className="grid gap-3 p-4">
          <label className="grid gap-1 text-[12px] font-medium text-[var(--color-text-secondary)]">
            Scenario
            <select value={selectedScenario?.name ?? ''} onChange={(event) => setSelectedScenarioName(event.target.value)} className="h-9 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-2 text-[13px] text-[var(--color-text-primary)]">
              {scenarios.length === 0 ? <option value="">No scenarios</option> : null}
              {scenarios.map((scenario) => <option key={scenario.id} value={scenario.name}>{scenario.displayName || scenario.name}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onRunScenario('agentRuntime')} disabled={!selectedScenario || running} className="intera-q2-button inline-flex h-9 flex-1 items-center justify-center gap-2 bg-[var(--color-accent-primary)] px-3 text-[13px] font-medium text-white disabled:opacity-50">
              {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Run runtime
            </button>
            <button type="button" onClick={() => onRunScenario('fixture')} disabled={!selectedScenario || running} className="intera-q2-button inline-flex h-9 flex-1 items-center justify-center gap-2 border border-[var(--color-border-subtle)] bg-white px-3 text-[13px] font-medium text-[var(--color-text-primary)] disabled:opacity-50">
              Fixture check
            </button>
          </div>
          <label className="grid gap-1 text-[12px] font-medium text-[var(--color-text-secondary)]">
            Fixture observed evidence JSON
            <textarea value={observedJson} onChange={(event) => setObservedJson(event.target.value)} rows={5} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-2 py-2 font-mono text-[11px] leading-4 text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent-primary)]" />
          </label>
          <ValidationTruthBlock validation={validation} latestRuntimeReceipt={latestRuntimeReceipt} latestFixtureReceipt={latestFixtureReceipt} />
        </div>
      </section>

      <ScenarioReceiptPanel compact receipt={selectedReceipt} receipts={receipts} selectedRunId={selectedReceiptRunId} onSelectReceipt={(receipt) => setSelectedReceiptRunId(receipt.runId)} />
    </aside>
  )
}

function PanelHeader({ icon: Icon, title, eyebrow }: { icon: typeof ClipboardList; title: string; eyebrow: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] bg-[rgba(53,127,124,0.09)] text-[var(--color-accent-primary)]">
        <Icon size={14} />
      </span>
      <div>
        <p className="text-[11px] font-medium text-[var(--color-text-tertiary)]">{eyebrow}</p>
        <h3 className="text-[14px] font-semibold text-[var(--color-text-primary)]">{title}</h3>
      </div>
    </div>
  )
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] py-1.5 last:border-b-0">
      <span className="text-[var(--color-text-tertiary)]">{label}</span>
      <span className="min-w-0 truncate text-right font-medium text-[var(--color-text-primary)]">{value}</span>
    </div>
  )
}

function ConfigPilotPatchList({ patches }: { patches: ConfigPilotPatch[] }) {
  return (
    <div className="grid gap-2">
      {patches.map((patch, index) => (
        <div key={`${patch.surface}-${patch.operation}-${index}`} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-[12px] text-[var(--color-text-secondary)]">
          <span className="font-semibold text-[var(--color-text-primary)]">{patch.surface}</span>
          <span> / {patch.operation}</span>
          <span className="ml-2 text-[var(--color-text-tertiary)]">{patchLabel(patch)}</span>
        </div>
      ))}
    </div>
  )
}

function ValidationTruthBlock({
  validation,
  latestRuntimeReceipt,
  latestFixtureReceipt,
}: {
  validation: ScenarioValidationSummary | null
  latestRuntimeReceipt: ScenarioReceipt | null
  latestFixtureReceipt: ScenarioReceipt | null
}) {
  const runtimeValidated = Boolean(validation?.runtimeValidated)
  return (
    <div className="grid gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] p-3 text-[12px] leading-5 text-[var(--color-text-secondary)]">
      <div className="flex items-center justify-between gap-3">
        <span>Runtime-backed validation status</span>
        <span className={`rounded-[var(--radius-control)] border px-2 py-0.5 font-semibold ${runtimeValidated ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          {runtimeValidated ? 'Runtime validated' : 'Not runtime validated'}
        </span>
      </div>
      <p>{runtimeValidated ? `Runtime receipt: ${latestRuntimeReceipt?.runId ?? validation?.lastReceiptId ?? 'recorded'}` : 'Fixture-only receipts are useful debugging evidence, but they are not runtime validation.'}</p>
      {latestFixtureReceipt && !runtimeValidated ? <p>Latest fixture-only receipt: {latestFixtureReceipt.status} ({latestFixtureReceipt.runId})</p> : null}
    </div>
  )
}

function ContextBadge({ context }: { context: ConfigPilotContextResponse | null }) {
  return (
    <span className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-3 text-[13px] font-medium text-[var(--color-text-secondary)]">
      <Bot size={15} className="text-[var(--color-accent-primary)]" />
      {context ? `${context.selected.name} v${context.selected.version}` : 'Reading draft'}
    </span>
  )
}

function ValidationBadge({ validation }: { validation: ScenarioValidationSummary | null }) {
  const state = validation?.state ?? 'Not validated'
  const runtimeValidated = Boolean(validation?.runtimeValidated)
  const color = runtimeValidated ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : state === 'Validation failed' ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-700'
  const Icon = runtimeValidated ? CheckCircle2 : state === 'Validation failed' ? XCircle : AlertTriangle
  return (
    <span className={`inline-flex h-9 items-center gap-2 rounded-[var(--radius-control)] border px-3 text-[13px] font-medium ${color}`}>
      <Icon size={15} /> {runtimeValidated ? 'Runtime validated' : state === 'Validated' ? 'Fixture-only validation' : state}
    </span>
  )
}

function proposalPhaseLabel(phase: ProposalPhase) {
  if (phase === 'proposing') return 'Generating proposal'
  if (phase === 'proposal') return 'Proposal ready'
  if (phase === 'diff') return 'Diff review'
  if (phase === 'accepted') return 'Accepted'
  if (phase === 'applying') return 'Applying draft'
  if (phase === 'applied') return 'Draft saved'
  return 'Ready'
}

function patchLabel(patch: ConfigPilotPatch): string {
  if (patch.surface === 'brain') return 'Agent Brain'
  if (patch.surface === 'hookBindings') return `${patch.value.hookName} -> ${patch.value.scopeType}`
  if ('target' in patch && patch.target) {
    if ('name' in patch.target) return String(patch.target.name)
    if ('type' in patch.target) return String(patch.target.type)
    if ('channel' in patch.target) return String(patch.target.channel)
  }
  if ('value' in patch && patch.value && typeof patch.value === 'object') {
    const value = patch.value as Record<string, unknown>
    return String(value.name ?? value.type ?? 'new draft object')
  }
  return 'draft object'
}
