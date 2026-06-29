import { randomUUID } from 'node:crypto'
import {
  AgentOpsSimulationReceiptSchema,
  type AgentOpsSimulationReceipt,
  type AgentOpsSimulationRequest,
  type AgentOpsSimulationTurnReceipt,
} from '@intera/shared/contracts/agentops/simulation'
import type { ScenarioTurn } from '@intera/shared/contracts/scenarios'
import type { ContentBlock, SSEEvent } from '@intera/shared/types'
import type { TraceRecord } from '@/lib/agent/persistence-port'
import { runPlaygroundTurn, type PlaygroundResult } from '@/lib/agent/playground-runner'
import { buildRuntimeEvidence } from '@/lib/scenarios/runtime-runner'
import type { SavedScenario } from '@intera/shared/contracts/scenarios'

interface RunAgentOpsSimulationInput {
  orgId: string
  agentId: string
  request: AgentOpsSimulationRequest
  scenario?: SavedScenario
  now?: Date
  simulationId?: string
}

interface TurnExecution {
  receipt: AgentOpsSimulationTurnReceipt
  events: SSEEvent[]
  rawTrace: TraceRecord[]
  chatId?: string
  caseId?: string
  latestTrace?: PlaygroundResult
}

export async function runAgentOpsSimulation(input: RunAgentOpsSimulationInput): Promise<AgentOpsSimulationReceipt> {
  const generatedAt = (input.now ?? new Date()).toISOString()
  const simulationId = input.simulationId ?? `sim_${randomUUID()}`
  const draftAgentConfigId = input.request.draftAgentConfigId ?? input.agentId
  const turns = resolveSimulationTurns(input.request, input.scenario)
  const sourceName = input.request.source.type === 'scenario'
    ? input.request.source.name
    : input.request.source.name ?? simulationId
  const userId = `agentops-sim:${simulationId}`
  const executions: TurnExecution[] = []
  let chatId: string | undefined
  let caseId: string | undefined

  for (let index = 0; index < turns.length; index += 1) {
    const execution = await runSimulationTurn({
      orgId: input.orgId,
      agentConfigId: draftAgentConfigId,
      userId,
      turn: turns[index],
      index,
      chatId,
      emitThinking: input.request.options.emitThinking,
    })
    chatId = execution.chatId ?? chatId
    caseId = execution.caseId ?? caseId
    executions.push(execution)
  }

  const allEvents = executions.flatMap((execution) => execution.events)
  const allRawTrace = executions.flatMap((execution) => execution.rawTrace)
  const latestTrace = executions.slice().reverse().find((execution) => execution.latestTrace)?.latestTrace
  const finalResponse = executions.slice().reverse().find((execution) => execution.receipt.assistantResponse.trim())?.receipt.assistantResponse ?? ''
  const finalEvidence = buildRuntimeEvidence({
    events: allEvents,
    rawTrace: allRawTrace,
    finalResponse,
    chatId,
    caseId,
    caseType: latestTrace?.caseType,
    traceId: latestTrace?.turnId ?? caseId ?? chatId,
  })
  const hasErrorEvent = allEvents.some((event) => event.type === 'error')
  const status = hasErrorEvent || executions.some((execution) => execution.receipt.blocked)
    ? 'blocked'
    : finalResponse.trim()
      ? 'pass'
      : 'fail'

  return AgentOpsSimulationReceiptSchema.parse({
    schemaVersion: 'agentops.simulation-receipt.v1',
    simulationId,
    generatedAt,
    status,
    mode: 'local_runtime',
    toolPolicy: 'mocked',
    agentId: input.agentId,
    draftAgentConfigId,
    source: {
      type: input.request.source.type,
      name: sourceName,
    },
    safety: {
      providerCalls: true,
      externalToolCalls: false,
      runtimeToolExecution: false,
      businessSideEffects: false,
      localPersistenceWrites: true,
      productionRuntimeSimulation: false,
      scenarioReceiptsAppended: false,
      scenarioValidationMarkedValidated: false,
      reason: 'Runs the local Playground AgentLoop with operational tools intercepted in dry-run mode. It may call the configured model provider and persists local Playground evidence only.',
    },
    session: {
      chatId,
      caseId,
      userId,
      turnCount: turns.length,
    },
    turns: executions.map((execution) => execution.receipt),
    finalEvidence,
    warnings: [
      'Simulation is local runtime evidence, not production proof.',
      'Operational tools are mocked through Playground dry-run interception.',
    ],
  })
}

function resolveSimulationTurns(
  request: AgentOpsSimulationRequest,
  scenario?: SavedScenario,
): Array<ScenarioTurn & { role: 'user' }> {
  if (request.source.type === 'turn_script') return request.source.turns
  if (!scenario) throw new Error(`Scenario "${request.source.name}" was not provided for simulation.`)
  return scenario.turns.filter((turn): turn is ScenarioTurn & { role: 'user' } => turn.role === 'user')
}

async function runSimulationTurn(input: {
  orgId: string
  agentConfigId: string
  userId: string
  turn: ScenarioTurn & { role: 'user' }
  index: number
  chatId?: string
  emitThinking: boolean
}): Promise<TurnExecution> {
  const events: SSEEvent[] = []
  const rawTrace: TraceRecord[] = []
  const warnings: string[] = []
  let chatId = input.chatId
  let caseId: string | undefined
  let assistantResponse = ''
  let latestTrace: PlaygroundResult | undefined
  let transition: string | undefined

  const stream = runPlaygroundTurn({
    orgId: input.orgId,
    message: input.turn.content,
    playgroundConfig: {
      debug: true,
      emitThinking: input.emitThinking,
      toolExecutionMode: 'dry_run',
    },
    configId: input.agentConfigId,
    chatId,
    userId: input.userId,
    contentBlocks: input.turn.contentBlocks as ContentBlock[] | undefined,
  })

  for await (const event of stream) {
    events.push(event)
    if (event.type === 'session_init' && isRecord(event.data)) {
      chatId = typeof event.data.chatId === 'string' ? event.data.chatId : chatId
      caseId = typeof event.data.caseId === 'string' ? event.data.caseId : caseId
    }
    if (event.type === 'text_delta') assistantResponse += String(event.data ?? '')
    if (event.type === 'message_stop' && isRecord(event.data)) {
      transition = typeof event.data.transition === 'string' ? event.data.transition : transition
    }
    if (event.type === 'trace' && isRecord(event.data)) {
      latestTrace = event.data as unknown as PlaygroundResult
      if (Array.isArray(latestTrace.rawTrace)) rawTrace.push(...latestTrace.rawTrace)
    }
    if (event.type === 'error') warnings.push(eventMessage(event))
  }

  const evidence = buildRuntimeEvidence({
    events,
    rawTrace,
    finalResponse: assistantResponse,
    chatId,
    caseId,
    caseType: latestTrace?.caseType,
    traceId: latestTrace?.turnId ?? caseId ?? chatId,
  })

  return {
    events,
    rawTrace,
    chatId,
    caseId,
    latestTrace,
    receipt: {
      index: input.index,
      userInput: input.turn.content,
      assistantResponse,
      caseType: latestTrace?.caseType || evidence.caseType,
      blocked: Boolean(latestTrace?.blocked) || events.some((event) => event.type === 'error' || event.type === 'hook_blocked'),
      transition,
      traceId: latestTrace?.turnId ?? caseId ?? chatId,
      totalMs: latestTrace?.totalMs,
      eventCounts: countEvents(events),
      toolCalls: (evidence.toolCalls ?? []).map((call) => ({
        name: call.name,
        executionMode: call.executionMode,
      })),
      toolResults: (evidence.toolResults ?? []).map((result) => ({
        name: result.name,
        executionMode: result.executionMode,
        errored: Boolean(result.error),
      })),
      warnings,
    },
  }
}

function countEvents(events: SSEEvent[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const event of events) {
    counts[event.type] = (counts[event.type] ?? 0) + 1
  }
  return counts
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function eventMessage(event: SSEEvent): string {
  if (typeof event.data === 'string') return event.data
  if (isRecord(event.data) && typeof event.data.message === 'string') return event.data.message
  return JSON.stringify(event.data ?? null)
}
