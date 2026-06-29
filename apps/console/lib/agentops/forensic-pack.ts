import { NotFoundError } from '@/lib/api/define-route'
import type { RepoForOrg } from '@/lib/db/repo-for-org'
import { hydrateMessageFromDb, isCustomerVisibleMessage } from '@/lib/agent/provider-transcript'
import { resolveChatAlias } from '@/lib/operate/chat-alias'
import {
  caseIdFilterForScope,
  resolveRequiredAgentCaseScopeForChat,
} from '@/app/api/_agent-scope'
import type {
  ForensicAttribution,
  ForensicAttributionStatus,
  ForensicCaseSummary,
  ForensicDocumentSummary,
  ForensicHookSummary,
  ForensicHumanTaskSummary,
  ForensicKnowledgeSummary,
  ForensicPack,
  ForensicProcedureRunSummary,
  ForensicTimelineEvidence,
  ForensicToolSummary,
  ForensicTranscriptMessage,
} from '@intera/shared/contracts/agentops/forensic-pack'

const PACK_VERSION = 'agentops.forensic-pack.v1' as const
const DEBUG_OMISSIONS = [
  {
    field: 'providerContent/providerMeta',
    reason: 'Debug Trace Pack only; this route returns customer-visible transcript text only.',
  },
  {
    field: 'llm_request_start prompt/messages/tools/toolChoice',
    reason: 'Debug Trace Pack only; Forensic Pack keeps only model and aggregate usage/latency summaries.',
  },
  {
    field: 'raw Tool input/output JSON',
    reason: 'Debug Trace Pack only; Forensic Pack returns selected keys and compact summaries.',
  },
  {
    field: 'raw KB backend ids and GPTBots payloads',
    reason: 'Debug Trace Pack only; Forensic Pack returns document titles, scores, previews, and hit/miss summaries.',
  },
  {
    field: 'cost',
    reason: 'Provider pricing is not safely derivable from current stored traces.',
  },
]

type JsonRecord = Record<string, unknown>

interface CaseRow {
  id: string
  userId: string
  chatId: string
  type: string
  status: string
  source: string
  goal: string | null
  blocker: string | null
  runtimeInputEpoch: number
  createdAt: Date
  updatedAt: Date
  resolvedAt: Date | null
}

interface ProcedureRunRow {
  id: string
  caseId: string
  chatId: string
  agentConfigId: string
  procedureId: string
  status: string
  inputEpoch: number
  currentStepId: string | null
  outcome: string | null
  state: unknown
  createdAt: Date
  updatedAt: Date
}

interface MessageRow {
  id: string
  caseId: string
  chatId: string
  runId: string | null
  role: string
  content: string | null
  contentBlocks?: unknown
  providerContent?: unknown
  providerMeta?: unknown
  createdAt: Date
}

interface TraceRow {
  id: string
  caseId: string
  chatId: string | null
  runId: string | null
  actionType: string
  title: string
  detail: string | null
  payload: string | null
  createdAt: Date
}

interface HumanTaskRow {
  id: string
  caseId: string
  chatId: string
  runId: string | null
  queue: string
  status: string
  question: string
  notes: string | null
  createdAt: Date
  resolvedAt: Date | null
}

interface ExternalConversationRow {
  internalCaseId: string | null
  platform: string
  externalChatId: string
  status: string
  metadata: unknown
}

interface AgentConfigRef {
  id: string
  name: string
  version: number
  isActive: boolean
  model: string
}

interface ToolRef {
  name: string
  mode: string
  toolCategory: string | null
}

interface KnowledgeSourceRef {
  name: string
}

export interface BuildForensicPackInput {
  repo: RepoForOrg
  agentId: string
  chatId: string
  translate?: string
}

interface BuildContext {
  agentId: string
  chatId: string
  casesById: Map<string, CaseRow>
  runsByCaseId: Map<string, ProcedureRunRow[]>
  allowedRunIds: Set<string>
  runById: Map<string, ProcedureRunRow>
  externalByCaseId: Map<string, ExternalConversationRow[]>
}

interface EvidenceRunScope {
  allowedRunIds: Set<string>
  nullRunCaseIds: Set<string>
}

interface ToolAccumulator {
  name: string
  calls: number
  results: number
  errors: number
  inputKeys: Set<string>
  outputSummary: string | null
  lastAt: string | null
  attribution: ForensicAttribution
}

interface KnowledgeAccumulator {
  toolName: string
  sourceName: string | null
  query: string | null
  hitCount: number | null
  miss: boolean | null
  documents: ForensicDocumentSummary[]
  lastAt: string | null
  attribution: ForensicAttribution
}

export async function buildChatForensicPack(input: BuildForensicPackInput): Promise<ForensicPack> {
  const requestedChatId = input.chatId
  const alias = await resolveChatAlias(input.repo, requestedChatId)
  const chatId = alias.resolvedChatId
  const scope = await resolveRequiredAgentCaseScopeForChat(input.repo, { agentId: input.agentId }, chatId)

  const scopedCaseWhere = { orgId: input.repo.orgId, chatId, ...caseIdFilterForScope(scope) }
  const cases = await input.repo.raw.case.findMany({
    where: scopedCaseWhere,
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      userId: true,
      chatId: true,
      type: true,
      status: true,
      source: true,
      goal: true,
      blocker: true,
      runtimeInputEpoch: true,
      createdAt: true,
      updatedAt: true,
      resolvedAt: true,
    },
  }) as CaseRow[]

  if (cases.length === 0) {
    throw new NotFoundError('Chat not found')
  }

  const caseIds = cases.map((caseRow) => caseRow.id)
  const [runs, messages, rawTraces, humanTasks, externalConversations, agentConfig, toolRefs, knowledgeRefs] = await Promise.all([
    input.repo.raw.procedureRun.findMany({
      where: {
        orgId: input.repo.orgId,
        caseId: { in: caseIds },
        agentConfigId: { in: [input.agentId, 'unknown', ''] },
      },
      orderBy: { createdAt: 'asc' as const },
      select: {
        id: true,
        caseId: true,
        chatId: true,
        agentConfigId: true,
        procedureId: true,
        status: true,
        inputEpoch: true,
        currentStepId: true,
        outcome: true,
        state: true,
        createdAt: true,
        updatedAt: true,
      },
    }) as Promise<ProcedureRunRow[]>,
    input.repo.raw.message.findMany({
      where: {
        orgId: input.repo.orgId,
        chatId,
        caseId: { in: caseIds },
      },
      orderBy: { createdAt: 'asc' as const },
      select: {
        id: true,
        caseId: true,
        chatId: true,
        runId: true,
        role: true,
        content: true,
        contentBlocks: true,
        providerContent: true,
        providerMeta: true,
        createdAt: true,
      },
    }) as Promise<MessageRow[]>,
    input.repo.raw.actionTrace.findMany({
      where: {
        orgId: input.repo.orgId,
        caseId: { in: caseIds },
      },
      orderBy: { createdAt: 'asc' as const },
      select: {
        id: true,
        caseId: true,
        chatId: true,
        runId: true,
        actionType: true,
        title: true,
        detail: true,
        payload: true,
        createdAt: true,
      },
    }) as Promise<TraceRow[]>,
    input.repo.raw.humanTask.findMany({
      where: {
        orgId: input.repo.orgId,
        caseId: { in: caseIds },
      },
      orderBy: { createdAt: 'asc' as const },
      select: {
        id: true,
        caseId: true,
        chatId: true,
        runId: true,
        queue: true,
        status: true,
        question: true,
        notes: true,
        createdAt: true,
        resolvedAt: true,
      },
    }) as Promise<HumanTaskRow[]>,
    input.repo.externalConversation.findMany({
      where: {
        internalCaseId: { in: caseIds },
      },
      select: {
        internalCaseId: true,
        platform: true,
        externalChatId: true,
        status: true,
        metadata: true,
      },
    }) as Promise<ExternalConversationRow[]>,
    input.repo.agentConfig.findUnique({
      where: { id: input.agentId },
      select: { id: true, name: true, version: true, isActive: true, model: true },
    }) as Promise<AgentConfigRef | null>,
    input.repo.raw.tool.findMany({
      where: { agentConfigId: input.agentId },
      select: { name: true, mode: true, toolCategory: true },
    }) as Promise<ToolRef[]>,
    input.repo.raw.knowledgeSource.findMany({
      where: { agentConfigId: input.agentId, enabled: true },
      select: { name: true },
    }) as Promise<KnowledgeSourceRef[]>,
  ])

  const evidenceRunScope = buildEvidenceRunScope(cases, runs, input.agentId)
  const scopedRuns = runs.filter((run) => evidenceRunScope.allowedRunIds.has(run.id))
  const runsByCaseId = groupBy(scopedRuns, (run) => run.caseId)
  const runById = new Map(scopedRuns.map((run) => [run.id, run]))
  const externalByCaseId = groupBy(
    externalConversations.filter((row) => row.internalCaseId),
    (row) => row.internalCaseId as string,
  )
  const casesById = new Map(cases.map((caseRow) => [caseRow.id, caseRow]))
  const ctx: BuildContext = {
    agentId: input.agentId,
    chatId,
    casesById,
    runsByCaseId,
    allowedRunIds: evidenceRunScope.allowedRunIds,
    runById,
    externalByCaseId,
  }

  const traces = rawTraces.filter((trace) => evidenceBelongsToAllowedScope(trace, evidenceRunScope))
  const filteredMessages = messages.filter((message) => evidenceBelongsToAllowedScope(message, evidenceRunScope))
  const filteredHumanTasks = humanTasks.filter((task) => evidenceBelongsToAllowedScope(task, evidenceRunScope))
  const transcript = buildTranscript(filteredMessages, ctx)
  const toolRefByName = new Map(toolRefs.map((tool) => [tool.name, tool]))
  const evidence = buildEvidence(traces, filteredHumanTasks, ctx, toolRefByName)
  const metrics = buildMetrics(transcript.messages, traces)
  const caseAttributionsById = new Map(cases.map((caseRow) => [caseRow.id, deriveCaseAttribution(caseRow, ctx)]))
  const warnings = buildWarnings({
    input,
    chatId,
    cases,
    runs: scopedRuns,
    traces,
    transcriptMessages: transcript.messages,
    providerCount: metrics.providers.length,
    caseAttributions: [...caseAttributionsById.values()],
  })

  return {
    schemaVersion: PACK_VERSION,
    generatedAt: new Date().toISOString(),
    agentId: input.agentId,
    chatId,
    links: {
      operator: `/operate/conversations/${encodeURIComponent(chatId)}?agentId=${encodeURIComponent(input.agentId)}`,
      api: `/api/agentops/agents/${encodeURIComponent(input.agentId)}/chats/${encodeURIComponent(chatId)}/forensic-pack`,
    },
    attribution: summarizePackAttribution([...caseAttributionsById.values()]),
    transcript: {
      translatedTranscript: null,
      messages: transcript.messages,
      totalVisibleMessages: transcript.messages.length,
      omittedInternalMessages: transcript.omittedInternalMessages,
    },
    cases: cases.map((caseRow) => ({
      caseId: caseRow.id,
      userId: caseRow.userId,
      type: caseRow.type,
      status: caseRow.status,
      source: caseRow.source,
      goal: caseRow.goal,
      blocker: caseRow.blocker,
      runtimeInputEpoch: caseRow.runtimeInputEpoch,
      createdAt: toIso(caseRow.createdAt),
      updatedAt: toIso(caseRow.updatedAt),
      resolvedAt: caseRow.resolvedAt ? toIso(caseRow.resolvedAt) : null,
      attribution: caseAttributionsById.get(caseRow.id) ?? buildContextlessAttribution('unknown', 'Case attribution was not available.'),
    })),
    procedureRuns: scopedRuns.map((run) => buildProcedureRunSummary(run, ctx)),
    evidence,
    metrics,
    configRefs: {
      agentConfig,
      procedureIds: uniqueStrings(scopedRuns.map((run) => run.procedureId)),
      toolNames: evidence.tools.map((tool) => tool.name),
      hookNames: uniqueStrings(evidence.hooks.map((hook) => hook.hookName).filter(isString)),
      knowledgeSourceNames: uniqueStrings([
        ...knowledgeRefs.map((source) => source.name),
        ...evidence.knowledge.map((item) => item.sourceName).filter(isString),
      ]),
    },
    warnings,
    omissions: [
      ...DEBUG_OMISSIONS,
      ...(input.translate ? [{
        field: 'translatedTranscript',
        reason: `Translation request (${input.translate}) acknowledged but not generated in the read-only MVP.`,
      }] : []),
      ...(metrics.providers.length === 0 ? [{
        field: 'metrics.providers',
        reason: 'Provider was not explicitly stored in safe trace metadata.',
      }] : []),
    ],
  }
}

function buildTranscript(
  messages: MessageRow[],
  ctx: BuildContext,
): { messages: ForensicTranscriptMessage[]; omittedInternalMessages: number } {
  const transcript: ForensicTranscriptMessage[] = []
  let omittedInternalMessages = 0

  for (const message of messages) {
    const hydrated = hydrateMessageFromDb(message)
    if (!isCustomerVisibleMessage(hydrated)) {
      omittedInternalMessages += 1
      continue
    }

    const caseRow = ctx.casesById.get(message.caseId)
    transcript.push({
      index: transcript.length,
      role: hydrated.role,
      content: renderCustomerVisibleContent(hydrated),
      createdAt: toIso(message.createdAt),
      caseId: message.caseId,
      runId: message.runId ?? null,
      procedureType: caseRow?.type ?? null,
      procedureStatus: caseRow?.status ?? null,
      attribution: deriveEvidenceAttribution(message, ctx),
    })
  }

  return { messages: transcript, omittedInternalMessages }
}

function buildProcedureRunSummary(run: ProcedureRunRow, ctx: BuildContext): ForensicProcedureRunSummary {
  const state = asRecord(run.state)
  const steps = Array.isArray(state?.steps)
    ? state.steps
      .filter(isRecord)
      .map((step) => ({
        id: stringValue(step.id) ?? 'unknown',
        status: stringValue(step.status),
        startedAt: stringValue(step.startedAt),
        completedAt: stringValue(step.completedAt),
      }))
    : []

  const timeline = Array.isArray(state?.timeline)
    ? state.timeline
      .filter(isRecord)
      .map((event) => ({
        at: stringValue(event.at),
        origin: stringValue(event.origin),
        source: stringValue(event.source),
        summary: summarizeProcedureTimelineEvent(event),
        basedOnInputEpoch: numberValue(event.basedOnInputEpoch),
        isMeta: booleanValue(event.isMeta),
      }))
    : []

  return {
    runId: run.id,
    caseId: run.caseId,
    procedureId: run.procedureId,
    status: run.status,
    inputEpoch: run.inputEpoch,
    currentStepId: run.currentStepId,
    outcome: run.outcome,
    createdAt: toIso(run.createdAt),
    updatedAt: toIso(run.updatedAt),
    steps,
    blockers: Array.isArray(state?.blockers)
      ? state.blockers.map((item) => stringValue(item)).filter(isString).map((item) => truncate(item, 240))
      : [],
    timeline,
    attribution: deriveRunAttribution(run, ctx),
  }
}

function buildEvidence(
  traces: TraceRow[],
  humanTasks: HumanTaskRow[],
  ctx: BuildContext,
  toolRefByName: Map<string, ToolRef>,
): ForensicPack['evidence'] {
  const toolAcc = new Map<string, ToolAccumulator>()
  const knowledgeAcc = new Map<string, KnowledgeAccumulator>()
  const hooks: ForensicHookSummary[] = []
  const timeline: ForensicTimelineEvidence[] = []

  for (const trace of traces) {
    const payload = safeJsonRecord(trace.payload)
    const kind = classifyTraceKind(trace, payload)
    const toolName = toolNameFromTrace(trace, payload)
    const attribution = deriveEvidenceAttribution(trace, ctx)

    if ((trace.actionType === 'tool_call' || trace.actionType === 'tool_result') && toolName) {
      const acc = toolAcc.get(toolName) ?? {
        name: toolName,
        calls: 0,
        results: 0,
        errors: 0,
        inputKeys: new Set<string>(),
        outputSummary: null,
        lastAt: null,
        attribution,
      }
      if (trace.actionType === 'tool_call') {
        acc.calls += 1
        for (const key of Object.keys(asRecord(payload?.input) ?? {})) {
          if (!isSensitiveKey(key)) acc.inputKeys.add(key)
        }
      } else {
        acc.results += 1
        if (isErrorPayload(payload)) acc.errors += 1
        acc.outputSummary = summarizeToolOutput(payload)
      }
      acc.lastAt = toIso(trace.createdAt)
      acc.attribution = mergeAttribution(acc.attribution, attribution)
      toolAcc.set(toolName, acc)
    }

    if ((kind === 'knowledge' || toolName?.startsWith('kb_search_')) && toolName) {
      const knowledge = summarizeKnowledgeTrace(trace, payload, toolName, attribution)
      const key = `${toolName}:${knowledge.sourceName ?? ''}:${knowledge.query ?? ''}`
      const existing = knowledgeAcc.get(key)
      knowledgeAcc.set(key, existing ? mergeKnowledge(existing, knowledge) : knowledge)
    }

    if (trace.actionType === 'hook_hit') {
      hooks.push({
        hookName: stringValue(payload?.hookName),
        checkpoint: stringValue(payload?.checkpoint),
        action: stringValue(payload?.action) ?? stringValue(payload?.result),
        status: hookStatusFromPayload(payload),
        reason: stringValue(payload?.reason),
        at: toIso(trace.createdAt),
        attribution,
      })
    }

    if (trace.actionType === 'loop_decision' && isHookDecisionTitle(trace.title)) {
      const results = Array.isArray(payload?.results)
        ? payload.results.filter(isRecord)
        : []
      if (results.length === 0) {
        hooks.push({
          hookName: null,
          checkpoint: stringValue(payload?.checkpoint),
          action: stringValue(payload?.summary) ?? stringValue(payload?.result),
          status: hookStatusFromPayload(payload),
          reason: stringValue(payload?.reason),
          at: toIso(trace.createdAt),
          attribution,
        })
      } else {
        for (const result of results) {
          hooks.push({
            hookName: stringValue(result.hookName),
            checkpoint: stringValue(payload?.checkpoint),
            action: stringValue(result.action) ?? stringValue(result.result),
            status: stringValue(result.action) ?? stringValue(result.result),
            reason: stringValue(result.reason),
            at: toIso(trace.createdAt),
            attribution,
          })
        }
      }
    }

    const timelineEntry = summarizeTimelineTrace(trace, payload, kind, attribution)
    if (timelineEntry) timeline.push(timelineEntry)
  }

  const tools: ForensicToolSummary[] = [...toolAcc.values()]
    .map((acc) => {
      const ref = toolRefByName.get(acc.name)
      return {
        name: acc.name,
        calls: acc.calls,
        results: acc.results,
        errors: acc.errors,
        inputKeys: [...acc.inputKeys].sort(),
        outputSummary: acc.outputSummary,
        mode: ref?.mode ?? null,
        category: ref?.toolCategory ?? null,
        lastAt: acc.lastAt,
        attribution: acc.attribution,
      }
    })
    .sort((a, b) => (a.lastAt ?? '').localeCompare(b.lastAt ?? ''))

  return {
    tools,
    knowledge: [...knowledgeAcc.values()].sort((a, b) => (a.lastAt ?? '').localeCompare(b.lastAt ?? '')),
    hooks,
    humanTasks: humanTasks.map((task) => ({
      queue: task.queue,
      status: task.status,
      question: truncateNullable(task.question, 500),
      notes: truncateNullable(task.notes, 500),
      createdAt: toIso(task.createdAt),
      resolvedAt: task.resolvedAt ? toIso(task.resolvedAt) : null,
      attribution: deriveEvidenceAttribution(task, ctx),
    })),
    timeline,
  }
}

function buildMetrics(
  transcript: ForensicTranscriptMessage[],
  traces: TraceRow[],
): ForensicPack['metrics'] {
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
  }
  const models = new Set<string>()
  const providers = new Set<string>()
  let firstTraceMs: number | null = null
  let lastTraceMs: number | null = null
  let llmWallMs = 0
  let toolsWallMs = 0
  let iterationWallMs = 0
  let toolLatencyMs = 0

  for (const trace of traces) {
    const at = trace.createdAt.getTime()
    firstTraceMs = firstTraceMs == null ? at : Math.min(firstTraceMs, at)
    lastTraceMs = lastTraceMs == null ? at : Math.max(lastTraceMs, at)

    const payload = safeJsonRecord(trace.payload)
    const model = stringValue(payload?.model)
    if (model) models.add(model)
    const provider = providerFromPayload(payload)
    if (provider) providers.add(provider)

    if (trace.actionType === 'llm_response') {
      const payloadUsage = asRecord(payload?.usage) ?? safeJsonRecord(trace.detail)?.usage
      const usageRecord = asRecord(payloadUsage)
      usage.inputTokens += coerceTokenCount(usageRecord, ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens'])
      usage.outputTokens += coerceTokenCount(usageRecord, ['output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens'])
      usage.cacheReadTokens += coerceTokenCount(usageRecord, ['cache_read_input_tokens', 'cacheReadTokens', 'cache_read_tokens'])
      usage.cacheWriteTokens += coerceTokenCount(usageRecord, ['cache_creation_input_tokens', 'cacheWriteTokens', 'cache_write_tokens'])
      usage.totalTokens += coerceTokenCount(usageRecord, ['total_tokens', 'totalTokens'])
    }

    if (trace.actionType === 'loop_decision' && trace.title === 'Iteration Snapshot') {
      llmWallMs += numberValue(payload?.llmWallMs) ?? 0
      toolsWallMs += numberValue(payload?.toolsWallMs) ?? 0
      iterationWallMs += numberValue(payload?.iterationWallMs) ?? 0
    }

    if (trace.actionType === 'tool_result') {
      toolLatencyMs += numberValue(payload?.latencyMs) ?? 0
    }
  }

  if (usage.totalTokens === 0) {
    usage.totalTokens = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  }

  return {
    models: [...models].sort(),
    providers: [...providers].sort(),
    usage,
    latency: {
      firstResponseMs: firstResponseLatencyMs(transcript),
      totalTraceSpanMs: firstTraceMs != null && lastTraceMs != null ? Math.max(0, lastTraceMs - firstTraceMs) : null,
      llmWallMs: llmWallMs > 0 ? llmWallMs : null,
      toolsWallMs: toolsWallMs > 0 ? toolsWallMs : null,
      iterationWallMs: iterationWallMs > 0 ? iterationWallMs : null,
      toolLatencyMs: toolLatencyMs > 0 ? toolLatencyMs : null,
    },
    cost: null,
  }
}

function buildWarnings(args: {
  input: BuildForensicPackInput
  chatId: string
  cases: CaseRow[]
  runs: ProcedureRunRow[]
  traces: TraceRow[]
  transcriptMessages: ForensicTranscriptMessage[]
  providerCount: number
  caseAttributions: ForensicAttribution[]
}): string[] {
  const warnings: string[] = []
  if (args.input.translate) {
    warnings.push('Translation was requested but is omitted in the read-only MVP.')
  }
  if (args.runs.length === 0) {
    warnings.push('No ProcedureRun rows were safely attributed to this agent/chat.')
  }
  if (args.traces.length === 0) {
    warnings.push('No ActionTrace evidence was found for the scoped cases.')
  }
  if (args.transcriptMessages.length === 0) {
    warnings.push('No customer-visible transcript messages were found after provider/internal filtering.')
  }
  if (args.providerCount === 0) {
    warnings.push('Provider is unavailable because safe trace metadata does not include an explicit provider field.')
  }
  if (args.caseAttributions.some((attribution) => attribution.status === 'legacy_or_unattributed')) {
    warnings.push('Some case evidence is legacy or unattributed and is included only with low attribution confidence.')
  }
  return warnings
}

function renderCustomerVisibleContent(message: { content?: unknown; contentBlocks?: unknown }): string {
  if (typeof message.content === 'string' && message.content.trim()) {
    return truncate(message.content.trim(), 8000)
  }
  if (Array.isArray(message.contentBlocks)) {
    const parts = message.contentBlocks
      .filter(isRecord)
      .map((block) => {
        if (block.type === 'text' && typeof block.text === 'string') return block.text.trim()
        if (block.type === 'image') return '[image input]'
        return '[non-text content]'
      })
      .filter((part) => part.length > 0)
    if (parts.length > 0) return truncate(parts.join('\n'), 8000)
  }
  return '[non-text content]'
}

function deriveEvidenceAttribution(
  item: { caseId: string; runId?: string | null },
  ctx: BuildContext,
): ForensicAttribution {
  if (item.runId && ctx.allowedRunIds.has(item.runId)) {
    const run = ctx.runById.get(item.runId)
    if (run) return deriveRunAttribution(run, ctx)
    return { status: 'procedure_run', confidence: 'high', reason: 'Evidence row references a scoped ProcedureRun.' }
  }
  const caseRow = ctx.casesById.get(item.caseId)
  if (!caseRow) return { status: 'unknown', confidence: 'unknown', reason: 'Case row was not available.' }
  return deriveCaseAttribution(caseRow, ctx)
}

export function deriveCaseAttribution(caseRow: CaseRow, ctx: BuildContext): ForensicAttribution {
  const runs = ctx.runsByCaseId.get(caseRow.id) ?? []
  if (runs.some((run) => run.agentConfigId === ctx.agentId)) {
    return { status: 'procedure_run', confidence: 'high', reason: 'Case has a ProcedureRun for the requested agent.' }
  }

  const external = ctx.externalByCaseId.get(caseRow.id) ?? []
  if (external.some((row) => metadataAgentConfigId(row.metadata) === ctx.agentId)) {
    return { status: 'livechat_metadata', confidence: 'high', reason: 'LiveChat metadata carries the requested agentConfigId.' }
  }

  if (isPlaygroundChatForAgent(ctx.chatId, ctx.agentId)) {
    return { status: 'playground_prefix', confidence: 'medium', reason: 'Playground chatId prefix carries the requested agentConfigId.' }
  }

  if (runs.length === 0 || runs.every((run) => isLegacyRunAgentConfig(run.agentConfigId))) {
    return { status: 'legacy_or_unattributed', confidence: 'low', reason: 'Scoped exact-chat evidence has no agent-stamped ProcedureRun.' }
  }

  return { status: 'unknown', confidence: 'unknown', reason: 'No safe attribution source matched this case.' }
}

function deriveRunAttribution(run: ProcedureRunRow, ctx: BuildContext): ForensicAttribution {
  if (run.agentConfigId === ctx.agentId) {
    return { status: 'procedure_run', confidence: 'high', reason: 'ProcedureRun.agentConfigId matches the requested agent.' }
  }
  if (isLegacyRunAgentConfig(run.agentConfigId) && isPlaygroundChatForAgent(ctx.chatId, ctx.agentId)) {
    return { status: 'playground_prefix', confidence: 'medium', reason: 'Legacy ProcedureRun is attached to an agent-prefixed playground chat.' }
  }
  return { status: 'legacy_or_unattributed', confidence: 'low', reason: 'ProcedureRun lacks a safe agentConfigId.' }
}

function summarizePackAttribution(attributions: ForensicAttribution[]): ForensicAttribution {
  const priority: ForensicAttributionStatus[] = [
    'procedure_run',
    'livechat_metadata',
    'playground_prefix',
    'legacy_or_unattributed',
    'unknown',
  ]
  for (const status of priority) {
    const match = attributions.find((attribution) => attribution.status === status)
    if (match) return match
  }
  return { status: 'unknown', confidence: 'unknown', reason: 'No evidence rows were attributed.' }
}

function summarizeTimelineTrace(
  trace: TraceRow,
  payload: JsonRecord | null,
  kind: ForensicTimelineEvidence['kind'],
  attribution: ForensicAttribution,
): ForensicTimelineEvidence | null {
  if (trace.actionType === 'llm_request_start') return null
  if (trace.actionType.startsWith('provider_transcript_')) return null
  if (trace.actionType === 'loop_decision' && trace.title === 'Iteration Snapshot') return null

  const summary = summaryForTrace(trace, payload)
  if (!summary && !isTimelineWorthy(trace.actionType)) return null

  return {
    kind,
    actionType: trace.actionType,
    title: truncate(trace.title || trace.actionType, 240),
    summary,
    status: statusForTrace(trace, payload),
    at: toIso(trace.createdAt),
    attribution,
  }
}

function summaryForTrace(trace: TraceRow, payload: JsonRecord | null): string | null {
  const toolName = toolNameFromTrace(trace, payload)
  if (trace.actionType === 'tool_call') {
    const input = asRecord(payload?.input)
    const keys = input ? Object.keys(input).filter((key) => !isSensitiveKey(key)).sort() : []
    return keys.length > 0 ? `${toolName ?? 'Tool'} input keys: ${keys.join(', ')}` : `${toolName ?? 'Tool'} called`
  }
  if (trace.actionType === 'tool_result') {
    return summarizeToolOutput(payload)
  }
  if (trace.actionType === 'form_request') {
    const fields = Array.isArray(payload?.fields) ? payload.fields.filter(isRecord) : []
    const labels = fields.map((field) => stringValue(field.label) ?? stringValue(field.id)).filter(isString)
    return labels.length > 0 ? `Requested fields: ${labels.slice(0, 8).join(', ')}` : 'Form requested'
  }
  if (trace.actionType === 'form_submit') {
    const answers = asRecord(payload?.answers)
    const keys = answers ? Object.keys(answers).filter((key) => !isSensitiveKey(key)).sort() : []
    return keys.length > 0 ? `Submitted answer keys: ${keys.join(', ')}` : 'Form submitted'
  }
  if (trace.actionType === 'llm_response') {
    const usage = asRecord(payload?.usage)
    const model = stringValue(payload?.model)
    const inputTokens = coerceTokenCount(usage, ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens'])
    const outputTokens = coerceTokenCount(usage, ['output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens'])
    return [model ? `model: ${model}` : null, inputTokens > 0 ? `input tokens: ${inputTokens}` : null, outputTokens > 0 ? `output tokens: ${outputTokens}` : null]
      .filter(isString)
      .join(' · ') || 'Model response recorded'
  }
  if (trace.actionType === 'hook_hit' || (trace.actionType === 'loop_decision' && isHookDecisionTitle(trace.title))) {
    const hookName = stringValue(payload?.hookName)
    const status = hookStatusFromPayload(payload)
    const reason = stringValue(payload?.reason)
    return [hookName ? `hook: ${hookName}` : null, status ? `status: ${status}` : null, reason ? `reason: ${truncate(reason, 180)}` : null]
      .filter(isString)
      .join(' · ') || 'Hook decision recorded'
  }
  if (trace.actionType === 'human_task_created' || trace.actionType === 'human_task_resolved' || trace.actionType === 'escalated') {
    const queue = stringValue(payload?.queue)
    const status = stringValue(payload?.status)
    const reason = stringValue(payload?.reason)
    return [queue ? `queue: ${queue}` : null, status ? `status: ${status}` : null, reason ? `reason: ${truncate(reason, 180)}` : null]
      .filter(isString)
      .join(' · ') || 'Human task event recorded'
  }
  if (trace.actionType === 'channel_rich_message') {
    const richType = stringValue(payload?.richType) ?? stringValue(payload?.rendererAction)
    return richType ? `channel rich message: ${richType}` : 'Channel rich message recorded'
  }
  return null
}

function summarizeToolOutput(payload: JsonRecord | null): string | null {
  if (!payload) return null
  if (typeof payload.error === 'string' && payload.error.trim()) return `Error present (${payload.error.trim().length} chars)`
  const output = unwrapOutput(payload.output ?? payload.result)
  if (output == null) return null
  if (typeof output === 'string') return `Text result (${output.length} chars)`
  if (Array.isArray(output)) return `Returned ${output.length} item${output.length === 1 ? '' : 's'}`
  if (isRecord(output)) {
    const error = stringValue(output.error)
    const message = stringValue(output.message)
    const status = stringValue(output.status)
    if (output.ok === false || output.success === false || error) {
      return [
        'Failure result',
        error ? `error present (${error.length} chars)` : null,
        message ? `message present (${message.length} chars)` : null,
        status ? 'status present' : null,
      ].filter(isString).join(' · ')
    }
    const list = arrayValue(output.list) ?? arrayValue(output.hits) ?? arrayValue(output.data)
    if (list) return list.length === 0 ? 'No items returned' : `Returned ${list.length} item${list.length === 1 ? '' : 's'}`
    if (status) return 'status present'
    const safeScalarKeys = Object.keys(output).filter((key) => !isSensitiveKey(key) && isSafeScalar(output[key]))
    if (safeScalarKeys.length > 0) return `fields: ${safeScalarKeys.slice(0, 8).sort().join(', ')}`
    return `Structured result (${Object.keys(output).length} fields)`
  }
  return `Scalar result (${typeof output})`
}

function summarizeProcedureTimelineEvent(event: JsonRecord): string {
  const source = stringValue(event.source)
  const eventType = stringValue(event.type)
  const summary = stringValue(event.summary)
  const sourceKey = `${source ?? ''} ${eventType ?? ''}`
  if (/\btool_(?:call|result)\b/.test(sourceKey)) {
    const status = stringValue(event.status) ?? stringValue(event.result)
    return [
      sourceKey.includes('tool_call') ? 'Tool call recorded' : 'Tool result recorded',
      status ? 'status present' : null,
      summary ? `summary length: ${summary.length} chars` : null,
    ].filter(isString).join(' · ')
  }
  return truncate(summary ?? eventType ?? 'Procedure event', 300)
}

function summarizeKnowledgeTrace(
  trace: TraceRow,
  payload: JsonRecord | null,
  toolName: string,
  attribution: ForensicAttribution,
): KnowledgeAccumulator {
  const input = asRecord(payload?.input)
  const output = unwrapOutput(payload?.output ?? payload?.result)
  const outputRecord = asRecord(output)
  const hits = extractKnowledgeHits(outputRecord ?? output)
  const query = stringValue(input?.query) ?? stringValue(input?.prompt)
  const sourceName = (
    stringValue(payload?.knowledgeSourceName) ??
    stringValue(outputRecord?.knowledgeSourceName) ??
    toolName.replace(/^kb_search_/, '')
  ) || null

  return {
    toolName,
    sourceName,
    query: query ? truncate(query, 240) : null,
    hitCount: hits ? hits.length : null,
    miss: hits ? hits.length === 0 : null,
    documents: hits ? hits.slice(0, 5).map(summarizeKnowledgeDocument) : [],
    lastAt: toIso(trace.createdAt),
    attribution,
  }
}

function mergeKnowledge(existing: KnowledgeAccumulator, next: KnowledgeAccumulator): KnowledgeAccumulator {
  return {
    ...existing,
    hitCount: next.hitCount ?? existing.hitCount,
    miss: next.miss ?? existing.miss,
    documents: next.documents.length > 0 ? next.documents : existing.documents,
    lastAt: next.lastAt ?? existing.lastAt,
    attribution: mergeAttribution(existing.attribution, next.attribution),
  }
}

function summarizeKnowledgeDocument(value: unknown): ForensicDocumentSummary {
  const record = asRecord(value)
  if (!record) return { title: null, score: null, contentPreview: null }
  const title =
    stringValue(record.document_name) ??
    stringValue(record.documentName) ??
    stringValue(record.title) ??
    stringValue(record.name) ??
    null
  const content =
    stringValue(record.content) ??
    stringValue(record.text) ??
    stringValue(record.chunk) ??
    stringValue(record.chunk_content) ??
    null
  return {
    title: title ? truncate(title, 160) : null,
    score: finiteNumberValue(record.score),
    contentPreview: content ? truncate(content, 360) : null,
  }
}

function buildContextlessAttribution(status: ForensicAttributionStatus, reason: string): ForensicAttribution {
  return {
    status,
    confidence: status === 'unknown' ? 'unknown' : 'low',
    reason,
  }
}

function mergeAttribution(a: ForensicAttribution, b: ForensicAttribution): ForensicAttribution {
  return summarizePackAttribution([a, b])
}

function buildEvidenceRunScope(
  cases: CaseRow[],
  runs: ProcedureRunRow[],
  agentId: string,
): EvidenceRunScope {
  const selectedRunIdsByCaseId = new Map<string, Set<string>>()
  for (const run of runs) {
    if (run.agentConfigId !== agentId) continue
    const bucket = selectedRunIdsByCaseId.get(run.caseId) ?? new Set<string>()
    bucket.add(run.id)
    selectedRunIdsByCaseId.set(run.caseId, bucket)
  }

  const allowedRunIds = new Set<string>()
  const nullRunCaseIds = new Set<string>()
  for (const caseRow of cases) {
    const selectedRunIds = selectedRunIdsByCaseId.get(caseRow.id)
    if (selectedRunIds && selectedRunIds.size > 0) {
      for (const runId of selectedRunIds) allowedRunIds.add(runId)
      continue
    }

    nullRunCaseIds.add(caseRow.id)
    for (const run of runs) {
      if (run.caseId === caseRow.id && isLegacyRunAgentConfig(run.agentConfigId)) {
        allowedRunIds.add(run.id)
      }
    }
  }

  return { allowedRunIds, nullRunCaseIds }
}

function evidenceBelongsToAllowedScope(
  item: { caseId: string; runId?: string | null },
  evidenceScope: EvidenceRunScope,
): boolean {
  if (item.runId) return evidenceScope.allowedRunIds.has(item.runId)
  return evidenceScope.nullRunCaseIds.has(item.caseId)
}

function classifyTraceKind(trace: TraceRow, payload: JsonRecord | null): ForensicTimelineEvidence['kind'] {
  const toolName = toolNameFromTrace(trace, payload)
  if (trace.actionType === 'tool_call' || trace.actionType === 'tool_result') {
    return toolName?.startsWith('kb_search_') || payload?.knowledgeSourceId ? 'knowledge' : 'tool'
  }
  if (trace.actionType === 'hook_hit' || (trace.actionType === 'loop_decision' && isHookDecisionTitle(trace.title))) return 'hook'
  if (trace.actionType === 'human_task_created' || trace.actionType === 'human_task_resolved' || trace.actionType === 'escalated') return 'human_task'
  if (trace.actionType === 'llm_response' || trace.actionType === 'llm_request_start') return 'model'
  if (trace.actionType === 'final_resolution' || (trace.actionType === 'loop_decision' && isProcedureDecisionTitle(trace.title))) return 'procedure'
  if (trace.actionType === 'user_message') return 'customer'
  if (trace.actionType === 'channel_rich_message' || trace.actionType === 'incoming_chat') return 'channel'
  return 'runtime'
}

function statusForTrace(trace: TraceRow, payload: JsonRecord | null): string | null {
  if (trace.actionType === 'tool_result') {
    if (isErrorPayload(payload)) return 'warn'
    return 'ok'
  }
  if (trace.actionType === 'hook_hit' || (trace.actionType === 'loop_decision' && isHookDecisionTitle(trace.title))) {
    return hookStatusFromPayload(payload)
  }
  if (trace.actionType === 'human_task_created' || trace.actionType === 'escalated') return 'warn'
  if (trace.actionType === 'human_task_resolved' || trace.actionType === 'llm_response') return 'ok'
  return null
}

function hookStatusFromPayload(payload: JsonRecord | null): string | null {
  if (!payload) return null
  const summary = stringValue(payload.summary) ?? stringValue(payload.result) ?? stringValue(payload.action)
  if (summary) return summary
  const results = Array.isArray(payload.results) ? payload.results.filter(isRecord) : []
  const blocking = results.find((result) => result.action === 'block' || result.result === 'blocked')
  if (blocking) return 'block'
  const warning = results.find((result) => result.action === 'warn' || result.action === 'escalate' || result.result === 'escalated')
  if (warning) return 'warn'
  if (results.length > 0) return 'allow'
  return null
}

function isTimelineWorthy(actionType: string): boolean {
  return [
    'tool_call',
    'tool_result',
    'form_request',
    'form_submit',
    'channel_rich_message',
    'hook_hit',
    'human_task_created',
    'human_task_resolved',
    'escalated',
    'final_resolution',
    'llm_response',
    'user_message',
  ].includes(actionType)
}

function toolNameFromTrace(trace: TraceRow, payload: JsonRecord | null): string | undefined {
  const toolName = stringValue(payload?.toolName)
  if (toolName) return toolName
  const match = trace.title.match(/Tool(?: called| result)?:\s*(.+)$/)
  return match?.[1]?.trim()
}

function isHookDecisionTitle(title: string): boolean {
  return /^Hook\b/.test(title) || title.includes('Hook ') || title.includes('Stop Hook')
}

function isProcedureDecisionTitle(title: string): boolean {
  return title.includes('ProcedureRun') || title.startsWith('Procedure selected inline:') || title.startsWith('Procedure nudge:')
}

function metadataAgentConfigId(metadata: unknown): string | null {
  return stringValue(asRecord(metadata)?.agentConfigId)
}

function isPlaygroundChatForAgent(chatId: string, agentId: string): boolean {
  return chatId.startsWith(`pg_${agentId}_`)
}

function isLegacyRunAgentConfig(agentConfigId: string | null | undefined): boolean {
  const normalized = agentConfigId?.trim().toLowerCase()
  return !normalized || normalized === 'unknown'
}

function firstResponseLatencyMs(messages: ForensicTranscriptMessage[]): number | null {
  const firstUser = messages.find((message) => message.role === 'user')
  if (!firstUser) return null
  const firstAssistant = messages.find((message) => message.role === 'assistant' && message.createdAt >= firstUser.createdAt)
  if (!firstAssistant) return null
  return Math.max(0, new Date(firstAssistant.createdAt).getTime() - new Date(firstUser.createdAt).getTime())
}

function providerFromPayload(payload: JsonRecord | null): string | null {
  return stringValue(payload?.provider) ?? stringValue(payload?.providerFamily)
}

function coerceTokenCount(record: JsonRecord | null | undefined, keys: string[]): number {
  if (!record) return 0
  for (const key of keys) {
    const value = numberValue(record[key])
    if (value != null) return value
  }
  return 0
}

function isErrorPayload(payload: JsonRecord | null): boolean {
  if (!payload) return false
  if (typeof payload.error === 'string' && payload.error.trim()) return true
  const output = unwrapOutput(payload.output ?? payload.result)
  const record = asRecord(output)
  return record?.ok === false || record?.success === false || typeof record?.error === 'string'
}

function unwrapOutput(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const parsed = safeJson(value)
  return parsed ?? value
}

function extractKnowledgeHits(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  const record = asRecord(value)
  if (!record) return null
  const direct = arrayValue(record.list) ?? arrayValue(record.hits) ?? arrayValue(record.documents)
  if (direct) return direct
  const data = asRecord(record.data)
  return arrayValue(data?.list) ?? arrayValue(data?.hits) ?? null
}

function isSensitiveKey(key: string): boolean {
  return /(?:^|_)(?:id|ids|token|secret|password|key|headers?|authorization|cookie|provider|backend|group_ids?|data_ids?|chunk_ids?|doc_ids?)(?:_|$)/i.test(key)
}

function isSafeScalar(value: unknown): boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function safeJsonRecord(raw: string | null | undefined): JsonRecord | null {
  return asRecord(safeJson(raw))
}

function safeJson(raw: unknown): unknown {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const item of items) {
    const key = keyFn(item)
    const bucket = out.get(key) ?? []
    bucket.push(item)
    out.set(key, bucket)
  }
  return out
}

function asRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function arrayValue(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value))
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Math.max(0, Math.round(Number(value)))
  return null
}

function finiteNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

function truncateNullable(value: string | null | undefined, max: number): string | null {
  return value ? truncate(value, max) : null
}

function toIso(value: Date): string {
  return value.toISOString()
}

export const forensicPackTestInternals = {
  buildContextlessAttribution,
  isSensitiveKey,
  summarizeToolOutput,
}
