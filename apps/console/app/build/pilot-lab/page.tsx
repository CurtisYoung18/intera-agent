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
import { useConsoleLocale } from '@/components/locale-provider'
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

const PILOT_GREETING = {
  en: 'I have read the current draft. Ask me to create a flow, modify a prompt, add a Hook, run a Scenario, or check release risk.',
  zh: '我已读取当前 draft。你可以让我创建流程、修改 prompt、添加 hook、运行 scenario，或检查发布前风险。',
} as const
const DEFAULT_PROMPT = {
  en: 'Create a repeatable deposit handoff Scenario with tool evidence, Hook escalation, human transfer, and forbidden compensation wording.',
  zh: '创建一个可重复执行的入金交接 Scenario，要求包含工具证据、Hook 升级、人工转接，以及禁止补偿措辞。',
} as const
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
  const { t, locale } = useConsoleLocale()
  const isZh = locale === 'zh'
  const copy = isZh
    ? {
        failedToLoad: 'Pilot Lab 工作台加载失败',
        failedToGenerate: 'ConfigPilot proposal 生成失败',
        diffOpen: '差异已经在右侧控制面板展开。在你明确 accept 之前，apply 会保持禁用。',
        rejected: 'Proposal 已拒绝，没有任何草稿改动被写入。',
        rejectedMessage: '已拒绝，没有内容保存进 draft。',
        acceptRecorded: '已记录人工 accept，现在可以执行 apply。',
        appliedNotice: (count: number, state: string) => `已应用 ${count} 个草稿变更。当前验证状态：${state}。`,
        appliedMessage: (state: string) => `草稿已通过 typed API 保存。当前验证状态为 ${state}；发布前请再跑一次 runtime-backed Scenario。`,
        applyFailed: '应用已接受的草稿失败',
        applyFailedMessage: 'Apply 失败。已接受的 proposal 仍然保留，但没有触发发布或激活动作。',
        runtimeRunDone: (status: string) => `运行时 Scenario 已完成：${status}。`,
        fixtureRunDone: (status: string) => `静态样例 Scenario 已完成：${status}。`,
        invalidObservedJson: (message: string) => `observed evidence JSON 无效：${message}`,
        failedToRunScenario: '运行 Scenario 失败',
        currentAgent: '当前 Agent',
        loadingDraftContext: '正在读取 draft 上下文',
        loadingPilotContext: '正在加载 Pilot 上下文',
        pilotStatusLoader: 'Pilot 状态加载器',
        refresh: '刷新',
        generatingProposal: 'ConfigPilot 正在生成 typed patch proposal。draft 还没有被修改。',
        messagePilot: '给 U-Pilot 发消息',
        composerPlaceholder: '让 U-Pilot 创建流程、修改 prompt、添加 Hook、运行 Scenario，或检查发布风险…',
        sendMessage: '发送消息',
        loadContextMessage: '我现在还读不到当前 draft 上下文。请刷新，或切换到另一个 Agent 版本。',
        draftedProposalMessage: (title: string) => `我已经起草好 typed proposal：${title}。先查看右侧 diff，再决定是否接受。`,
      }
    : {
        failedToLoad: 'Failed to load Pilot cockpit',
        failedToGenerate: 'Failed to generate ConfigPilot proposal',
        diffOpen: 'Diff is open in the control panel. Apply remains disabled until you explicitly accept it.',
        rejected: 'Proposal rejected. No draft changes were written.',
        rejectedMessage: 'Rejected. Nothing was saved to the draft.',
        acceptRecorded: 'Human accept recorded. The apply action is now available.',
        appliedNotice: (count: number, state: string) => `Applied ${count} draft ${count === 1 ? 'change' : 'changes'}. Validation is now ${state}.`,
        appliedMessage: (state: string) => `Draft saved through typed APIs. Validation is now ${state}; run a runtime-backed Scenario before publishing.`,
        applyFailed: 'Failed to apply accepted draft',
        applyFailedMessage: 'Apply failed. The accepted proposal remains available, but no publish or activation action was called.',
        runtimeRunDone: (status: string) => `Runtime-backed Scenario run finished: ${status}.`,
        fixtureRunDone: (status: string) => `Fixture-only Scenario run finished: ${status}.`,
        invalidObservedJson: (message: string) => `Invalid observed evidence JSON: ${message}`,
        failedToRunScenario: 'Failed to run Scenario',
        currentAgent: 'Current agent',
        loadingDraftContext: 'Loading draft context',
        loadingPilotContext: 'Loading Pilot context',
        pilotStatusLoader: 'Pilot status loader',
        refresh: 'Refresh',
        generatingProposal: 'ConfigPilot is generating a typed patch proposal. The draft is not changed yet.',
        messagePilot: 'Message U-Pilot',
        composerPlaceholder: 'Ask U-Pilot to create a flow, modify a prompt, add a Hook, run a Scenario, or check release risk...',
        sendMessage: 'Send message',
        loadContextMessage: 'I could not read the current draft context. Refresh or select another Agent version.',
        draftedProposalMessage: (title: string) => `I drafted a typed proposal: ${title}. Review the right panel diff before accepting.`,
      }
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
          content: PILOT_GREETING[locale],
          streaming: true,
        },
      ])
      await loadScenarios(agentConfigId)
    } catch (err) {
      setError(err instanceof ApiClientError ? err.envelope.error.message : copy.failedToLoad)
      setMessages([
        {
          id: 'pilot-greeting-error',
          role: 'pilot',
          tone: 'danger',
          content: copy.loadContextMessage,
        },
      ])
    } finally {
      setLoading(false)
    }
  }, [agentConfigId, copy.failedToLoad, copy.loadContextMessage, loadScenarios, locale])

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
        content: copy.draftedProposalMessage(result.data.proposal.title),
        streaming: true,
      })
    } catch (err) {
      setProposalPhase('idle')
      setError(err instanceof ApiClientError ? err.envelope.error.message : copy.failedToGenerate)
      addMessage({
        role: 'pilot',
        tone: 'danger',
        content: isZh ? 'ConfigPilot 没能生成 typed proposal。draft 没有被改动。' : 'ConfigPilot could not create a typed proposal. The draft was not changed.',
      })
    }
  }, [addMessage, agentConfigId, copy.draftedProposalMessage, copy.failedToGenerate, isZh])

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
      content: copy.diffOpen,
    })
  }, [addMessage, copy.diffOpen, proposal])

  const rejectProposal = useCallback(() => {
    setProposal(null)
    setAccepted(false)
    setProposalPhase('idle')
    setNotice(copy.rejected)
    addMessage({
      role: 'pilot',
      tone: 'warning',
      content: copy.rejectedMessage,
    })
  }, [addMessage, copy.rejected, copy.rejectedMessage])

  const acceptProposal = useCallback((checked: boolean) => {
    setAccepted(checked)
    if (checked && proposalPhase === 'diff') {
      setProposalPhase('accepted')
      addMessage({
        role: 'system',
        tone: 'success',
        content: copy.acceptRecorded,
      })
    }
    if (!checked && proposalPhase === 'accepted') setProposalPhase('diff')
  }, [addMessage, copy.acceptRecorded, proposalPhase])

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
      setNotice(copy.appliedNotice(result.data.appliedPatches.length, result.data.validation.state))
      addMessage({
        role: 'pilot',
        tone: 'success',
        content: copy.appliedMessage(result.data.validation.state),
        streaming: true,
      })
      await loadScenarios(result.data.draftAgentConfigId)
      const contextResult = await apiClient<ConfigPilotContextResponse>(`/api/admin/config-pilot/context?agentConfigId=${encodeURIComponent(result.data.draftAgentConfigId)}`)
      setContext(contextResult.data)
    } catch (err) {
      setProposalPhase('accepted')
      setError(err instanceof ApiClientError ? err.envelope.error.message : copy.applyFailed)
      addMessage({
        role: 'pilot',
        tone: 'danger',
        content: copy.applyFailedMessage,
      })
    }
  }, [accepted, addMessage, agentConfigId, copy.appliedMessage, copy.appliedNotice, copy.applyFailed, copy.applyFailedMessage, loadScenarios, proposal, proposalPhase])

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
        content: executionMode === 'agentRuntime' ? copy.runtimeRunDone(result.data.receipt.status) : copy.fixtureRunDone(result.data.receipt.status),
        streaming: true,
      })
    } catch (err) {
      setError(err instanceof SyntaxError ? copy.invalidObservedJson(err.message) : err instanceof ApiClientError ? err.envelope.error.message : copy.failedToRunScenario)
    } finally {
      setRunning(false)
    }
  }, [addMessage, agentConfigId, copy.failedToRunScenario, copy.fixtureRunDone, copy.invalidObservedJson, copy.runtimeRunDone, observedJson, selectedScenario])

  if (activeTab === 'playground') {
    return (
      <div className="intera-q2-page flex h-full min-h-0 flex-col overflow-hidden px-3 py-3 text-[var(--color-text-primary)] sm:px-4 lg:px-5">
        <div className="mx-auto flex min-h-0 w-full max-w-[1580px] flex-1 flex-col gap-3">
          <VersionContextBar />
          <PilotLabTabs activeTab="playground" t={t} />
          <div className="intera-q2-panel min-h-0 flex-1 overflow-hidden">
            <PlaygroundPage />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="intera-q2-page flex h-full min-h-0 flex-col overflow-hidden px-3 py-3 text-[var(--color-text-primary)] sm:px-4 lg:px-5">
      <div className="mx-auto flex min-h-0 w-full max-w-[1580px] flex-1 flex-col gap-3">
        <VersionContextBar />

        <PilotLabTabs activeTab="pilot" t={t} />

        {(error || notice) && (
          <div className="grid gap-2">
            {error && <div className="rounded-[var(--radius-control)] border border-[color:color-mix(in_srgb,var(--color-signal-danger)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--color-signal-danger)_10%,white)] px-4 py-3 text-sm text-[var(--color-signal-danger)]">{error}</div>}
            {notice && <div className="rounded-[var(--radius-control)] border border-[color:color-mix(in_srgb,var(--color-signal-success)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--color-signal-success)_10%,white)] px-4 py-3 text-sm text-[var(--color-signal-success)]">{notice}</div>}
          </div>
        )}

        <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_440px] 2xl:grid-cols-[minmax(0,1fr)_480px]">
          <main className="intera-q2-panel flex min-h-0 min-w-0 flex-col overflow-hidden">
            <section className="flex items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-[var(--color-text-tertiary)]">{copy.currentAgent}</p>
                <h2 className="truncate text-[16px] font-semibold text-[var(--color-text-primary)]">
                  {context ? `${context.selected.name} v${context.selected.version}` : copy.loadingDraftContext}
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {loading ? <OrganicLoader variant="02" size={22} title={copy.loadingPilotContext} /> : <OrganicLoader variant={proposalPhase === 'proposing' ? '05' : '11'} size={22} title={copy.pilotStatusLoader} />}
                <ContextBadge context={context} />
                <ValidationBadge validation={validation} />
                <button type="button" onClick={loadCockpit} className="intera-q2-button inline-flex h-8 items-center gap-2 border border-[var(--color-border-subtle)] bg-white px-2.5 text-[12px] font-medium hover:bg-[var(--color-bg-surface-muted)]">
                  <RefreshCw size={13} /> {copy.refresh}
                </button>
                <span className="hidden text-[12px] text-[var(--color-text-tertiary)] sm:inline">{proposalPhaseLabel(proposalPhase, locale)}</span>
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
                      content: copy.generatingProposal,
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
                <label htmlFor="pilot-composer" className="sr-only">{copy.messagePilot}</label>
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
                  placeholder={copy.composerPlaceholder}
                  className="min-h-[52px] flex-1 resize-none rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-[14px] leading-5 text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent-primary)]"
                />
                <button type="submit" disabled={!composer.trim() || proposalPhase === 'proposing'} className="intera-q2-button flex h-[52px] w-[52px] shrink-0 items-center justify-center bg-[var(--color-accent-primary)] text-white disabled:opacity-50" aria-label={copy.sendMessage}>
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
              setComposer(DEFAULT_PROMPT[locale])
              void proposeFromPrompt(DEFAULT_PROMPT[locale])
            }}
          />
        </div>
      </div>
    </div>
  )
}

function PilotLabTabs({ activeTab, t, compact = false }: { activeTab: 'pilot' | 'playground'; t: (key: string) => string; compact?: boolean }) {
  const tabs = [
    { id: 'pilot' as const, href: '/build/pilot-lab', label: t('pilotLab.tabs.pilot'), description: t('pilotLab.tabs.pilotDesc') },
    { id: 'playground' as const, href: '/build/pilot-lab?tab=playground', label: t('pilotLab.tabs.playground'), description: t('pilotLab.tabs.playgroundDesc') },
  ]

  return (
    <nav className={`${compact ? 'flex flex-shrink-0 flex-wrap gap-2 px-1' : 'intera-q2-panel flex flex-wrap gap-2 p-3'}`} aria-label={t('pilotLab.tabs.aria')}>
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
            {!compact && <span className="hidden text-[11px] font-medium text-[var(--color-text-tertiary)] sm:inline">{tab.description}</span>}
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
  const { locale } = useConsoleLocale()
  const prompts = locale === 'zh'
    ? [
        '创建一个用于收集入金证据并转交人工的 Procedure。',
        '修改 prompt，让 Agent 在调用工具前先补问一个澄清问题。',
        '添加一个 Hook，在供应商证据互相冲突时自动升级。',
        '根据最新 Scenario 回执检查发布风险。',
      ]
    : [
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
  const { locale } = useConsoleLocale()
  const isZh = locale === 'zh'
  return (
    <aside className="min-h-0 min-w-0 space-y-3 overflow-y-auto xl:h-full xl:pr-1">
      <section className="intera-q2-rail p-4">
        <PanelHeader icon={ClipboardList} title={isZh ? '当前上下文' : 'Current context'} eyebrow={isZh ? '草稿视角' : 'Draft lens'} />
        {context ? (
          <div className="mt-4 grid gap-2 text-[12px] leading-5 text-[var(--color-text-secondary)]">
            <ContextRow label={isZh ? '已选版本' : 'Selected'} value={`${context.selected.name} v${context.selected.version}`} />
            <ContextRow label={isZh ? '草稿' : 'Draft'} value={context.draft ? `v${context.draft.version}` : (isZh ? '无' : 'none')} />
            <ContextRow label={isZh ? '当前 live' : 'Active'} value={context.active ? `v${context.active.version}` : (isZh ? '无' : 'none')} />
            <ContextRow label={isZh ? '模型' : 'Model'} value={modelUsed ?? context.selected.model} />
            <ContextRow label={isZh ? '提示词' : 'Prompt'} value={promptVersion ?? (isZh ? '上下文已加载' : 'context loaded')} />
            <ContextRow label={isZh ? 'Apply 权限' : 'Apply permission'} value={context.permissions.canApply ? (isZh ? 'accept 后可写入' : 'allowed after accept') : (isZh ? '只读' : 'read-only')} />
          </div>
        ) : (
          <p className="mt-4 text-[13px] text-[var(--color-text-tertiary)]">{isZh ? '正在加载 ConfigPilot 上下文。' : 'Loading ConfigPilot context.'}</p>
        )}
      </section>

      <section className="intera-q2-panel overflow-hidden">
        <div className="border-b border-[var(--color-border-subtle)] px-4 py-3">
          <PanelHeader icon={FileDiff} title={isZh ? '提议改动' : 'Proposed changes'} eyebrow={isZh ? '需要 accept' : 'Accept required'} />
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
                  <FileDiff size={15} /> {isZh ? '查看 diff' : 'Review diff'}
                </button>
                <button type="button" onClick={onReject} className="intera-q2-button inline-flex h-9 items-center gap-2 border border-red-200 bg-white px-3 text-[13px] font-medium text-red-700 hover:bg-red-50">
                  <RotateCcw size={15} /> {isZh ? '拒绝' : 'Reject'}
                </button>
              </div>
            </>
          ) : proposalPhase === 'proposing' ? (
            <div className="rounded-[var(--radius-control)] border border-[rgba(53,127,124,0.18)] bg-[rgba(53,127,124,0.06)] px-3 py-3 text-[13px] text-[var(--color-text-secondary)]">
              <TokenStreamPreview text={isZh ? '正在生成 typed draft proposal。' : 'Generating typed draft proposal.'} />
            </div>
          ) : (
            <div className="grid gap-3">
              <p className="text-[13px] leading-5 text-[var(--color-text-tertiary)]">{isZh ? '还没有 proposal。你可以从聊天开始，或直接使用后端默认的 ConfigPilot prompt。' : 'No proposal yet. Start from chat or use the backend ConfigPilot default prompt.'}</p>
              <button type="button" onClick={onUseDefaultPrompt} className="intera-q2-button inline-flex h-9 items-center justify-center gap-2 border border-[rgba(53,127,124,0.22)] bg-[rgba(53,127,124,0.08)] px-3 text-[13px] font-medium text-[var(--color-accent-primary)]">
                <Sparkles size={15} /> {isZh ? '生成 proposal' : 'Generate proposal'}
              </button>
            </div>
          )}
        </div>
      </section>

      {proposalPhase === 'diff' || proposalPhase === 'accepted' || proposalPhase === 'applying' || proposalPhase === 'applied' ? (
        <ConfigDiffViewer title={isZh ? 'Diff 查看器' : 'Diff viewer'} subtitle={isZh ? '请先核对精确的 typed patch 改动，再决定是否 accept。Pilot 这里只能保存草稿。' : 'Review exact typed patch changes before accepting. Pilot can save draft only.'} groups={diffGroups} emptyLabel={isZh ? '没有返回任何 diff 行。' : 'No diff rows were returned.'} />
      ) : (
        <section className="intera-q2-panel p-4">
          <PanelHeader icon={FileDiff} title={isZh ? 'Diff 查看器' : 'Diff viewer'} eyebrow={isZh ? '等待中' : 'Waiting'} />
          <div className="mt-4 rounded-[var(--radius-control)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] px-3 py-8 text-center text-[13px] text-[var(--color-text-tertiary)]">{isZh ? '打开 proposal review 后就能在这里检查 diff。' : 'Open proposal review to inspect the diff.'}</div>
        </section>
      )}

      <section className="intera-q2-panel p-4">
        <div className="grid gap-3">
          <label className={`flex items-start gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-[13px] leading-5 ${proposalPhase === 'diff' || proposalPhase === 'accepted' || proposalPhase === 'applying' ? 'border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] text-[var(--color-text-secondary)]' : 'border-[var(--color-border-subtle)] bg-white text-[var(--color-text-tertiary)]'}`}>
            <input type="checkbox" checked={accepted} disabled={proposalPhase !== 'diff' && proposalPhase !== 'accepted'} onChange={(event) => onAccept(event.target.checked)} className="mt-1" />
            <span>{isZh ? '我已经检查过 diff，并明确接受这些 draft 配置改动。' : 'I reviewed the diff and explicitly accept these draft configuration changes.'}</span>
          </label>
          <button type="button" onClick={onApply} disabled={!canApply || proposalPhase === 'applying'} className="intera-q2-button inline-flex h-10 items-center justify-center gap-2 bg-[var(--color-accent-primary)] px-4 text-[13px] font-semibold text-white disabled:opacity-50" data-testid="config-pilot-apply-draft">
            {proposalPhase === 'applying' ? <Loader2 size={15} className="animate-spin" /> : <LockKeyhole size={15} />} {isZh ? '应用已接受的草稿' : 'Apply accepted draft'}
          </button>
          <p className="text-[12px] leading-5 text-[var(--color-text-tertiary)]">{isZh ? '这里的 Apply 只会调用 `/api/admin/config-pilot/apply`，写入 draft 配置，并把验证标记为过期。发布、激活、部署和回滚都不在这里执行。' : 'Apply calls only `/api/admin/config-pilot/apply`, writes draft config, and marks validation stale. Publish, activate, deploy, and rollback are unavailable here.'}</p>
        </div>
      </section>

      <section className="intera-q2-panel overflow-hidden">
        <div className="border-b border-[var(--color-border-subtle)] px-4 py-3">
          <PanelHeader icon={Play} title={isZh ? 'Scenario 控制' : 'Scenario controls'} eyebrow={isZh ? '回执事实' : 'Receipt truth'} />
        </div>
        <div className="grid gap-3 p-4">
          <label className="grid gap-1 text-[12px] font-medium text-[var(--color-text-secondary)]">
            {isZh ? 'Scenario' : 'Scenario'}
            <select value={selectedScenario?.name ?? ''} onChange={(event) => setSelectedScenarioName(event.target.value)} className="h-9 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-2 text-[13px] text-[var(--color-text-primary)]">
              {scenarios.length === 0 ? <option value="">{isZh ? '暂无 Scenario' : 'No scenarios'}</option> : null}
              {scenarios.map((scenario) => <option key={scenario.id} value={scenario.name}>{scenario.displayName || scenario.name}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onRunScenario('agentRuntime')} disabled={!selectedScenario || running} className="intera-q2-button inline-flex h-9 flex-1 items-center justify-center gap-2 bg-[var(--color-accent-primary)] px-3 text-[13px] font-medium text-white disabled:opacity-50">
              {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} {isZh ? '运行时执行' : 'Run runtime'}
            </button>
            <button type="button" onClick={() => onRunScenario('fixture')} disabled={!selectedScenario || running} className="intera-q2-button inline-flex h-9 flex-1 items-center justify-center gap-2 border border-[var(--color-border-subtle)] bg-white px-3 text-[13px] font-medium text-[var(--color-text-primary)] disabled:opacity-50">
              {isZh ? '静态样例检查' : 'Fixture check'}
            </button>
          </div>
          <label className="grid gap-1 text-[12px] font-medium text-[var(--color-text-secondary)]">
            {isZh ? '静态样例 observed evidence JSON' : 'Fixture observed evidence JSON'}
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
  const { locale } = useConsoleLocale()
  const isZh = locale === 'zh'
  const runtimeValidated = Boolean(validation?.runtimeValidated)
  return (
    <div className="grid gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] p-3 text-[12px] leading-5 text-[var(--color-text-secondary)]">
      <div className="flex items-center justify-between gap-3">
        <span>{isZh ? '运行时验证状态' : 'Runtime-backed validation status'}</span>
        <span className={`rounded-[var(--radius-control)] border px-2 py-0.5 font-semibold ${runtimeValidated ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          {runtimeValidated ? (isZh ? '运行时已验证' : 'Runtime validated') : (isZh ? '尚未运行时验证' : 'Not runtime validated')}
        </span>
      </div>
      <p>{runtimeValidated ? (isZh ? `运行时回执：${latestRuntimeReceipt?.runId ?? validation?.lastReceiptId ?? '已记录'}` : `Runtime receipt: ${latestRuntimeReceipt?.runId ?? validation?.lastReceiptId ?? 'recorded'}`) : (isZh ? '仅 fixture 的回执可以帮助调试，但它不算运行时验证。' : 'Fixture-only receipts are useful debugging evidence, but they are not runtime validation.')}</p>
      {latestFixtureReceipt && !runtimeValidated ? <p>{isZh ? '最近一次 fixture-only 回执：' : 'Latest fixture-only receipt: '}{latestFixtureReceipt.status} ({latestFixtureReceipt.runId})</p> : null}
    </div>
  )
}

function ContextBadge({ context }: { context: ConfigPilotContextResponse | null }) {
  const { locale } = useConsoleLocale()
  return (
    <span className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-3 text-[13px] font-medium text-[var(--color-text-secondary)]">
      <Bot size={15} className="text-[var(--color-accent-primary)]" />
      {context ? `${context.selected.name} v${context.selected.version}` : locale === 'zh' ? '正在读取 draft' : 'Reading draft'}
    </span>
  )
}

function ValidationBadge({ validation }: { validation: ScenarioValidationSummary | null }) {
  const { locale } = useConsoleLocale()
  const state = validation?.state ?? 'Not validated'
  const runtimeValidated = Boolean(validation?.runtimeValidated)
  const color = runtimeValidated ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : state === 'Validation failed' ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-700'
  const Icon = runtimeValidated ? CheckCircle2 : state === 'Validation failed' ? XCircle : AlertTriangle
  return (
    <span className={`inline-flex h-9 items-center gap-2 rounded-[var(--radius-control)] border px-3 text-[13px] font-medium ${color}`}>
      <Icon size={15} /> {runtimeValidated ? (locale === 'zh' ? '运行时已验证' : 'Runtime validated') : state === 'Validated' ? (locale === 'zh' ? '仅 fixture 验证' : 'Fixture-only validation') : locale === 'zh' && state === 'Not validated' ? '尚未验证' : locale === 'zh' && state === 'Validation failed' ? '验证失败' : locale === 'zh' && state === 'Changed since last validation' ? '自上次验证后已变更' : state}
    </span>
  )
}

function proposalPhaseLabel(phase: ProposalPhase, locale: 'en' | 'zh') {
  if (phase === 'proposing') return locale === 'zh' ? '正在生成 proposal' : 'Generating proposal'
  if (phase === 'proposal') return locale === 'zh' ? 'Proposal 已就绪' : 'Proposal ready'
  if (phase === 'diff') return locale === 'zh' ? 'Diff 审查中' : 'Diff review'
  if (phase === 'accepted') return locale === 'zh' ? '已接受' : 'Accepted'
  if (phase === 'applying') return locale === 'zh' ? '正在应用草稿' : 'Applying draft'
  if (phase === 'applied') return locale === 'zh' ? '草稿已保存' : 'Draft saved'
  return locale === 'zh' ? '就绪' : 'Ready'
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
