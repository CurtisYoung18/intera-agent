import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  AgentOpsReplayReceiptSchema,
  type AgentOpsReplayAssertion,
  type AgentOpsReplayAssertionResult,
  type AgentOpsReplayReceipt,
  type AgentOpsReplayRequest,
  type AgentOpsReplayScenarioReceiptSummary,
  type AgentOpsReplayStatus,
} from '@intera/shared/contracts/agentops/replay'
import {
  scenarioObservedEvidenceSchema,
  type SavedScenario,
  type ScenarioObservedEvidence,
  type ScenarioReceipt,
} from '@intera/shared/contracts/scenarios'
import { runScenarioHarness } from '@/lib/scenarios/runner'

interface BuildAgentOpsReplayReceiptInput {
  agentId: string
  draftAgentConfigId: string
  request: AgentOpsReplayRequest
  scenario?: SavedScenario
  now?: Date
  receiptId?: string
}

interface EvidenceBundle {
  scenarioName: string
  evidence: ScenarioObservedEvidence
  scenarioReceipt: AgentOpsReplayScenarioReceiptSummary | null
}

interface PathLookup {
  found: boolean
  value?: unknown
}

const EXTERNAL_TOOL_STRING_INDICATORS = new Set([
  'runtime',
  'external',
  'live',
  'provider',
  'http',
  'side_effect',
  'side-effect',
  'side_effecting',
])

const EXTERNAL_TOOL_BOOLEAN_KEYS = [
  'external',
  'externalCall',
  'externalToolCall',
  'externalToolCalls',
  'runtimeExecuted',
  'sideEffect',
  'sideEffected',
  'sideEffecting',
]

const EXTERNAL_TOOL_STRING_KEYS = [
  'source',
  'origin',
  'mode',
  'toolMode',
  'executionSource',
  'executionMode',
]

export function buildAgentOpsReplayReceipt(input: BuildAgentOpsReplayReceiptInput): AgentOpsReplayReceipt {
  const generatedAt = (input.now ?? new Date()).toISOString()
  const evidenceBundle = buildEvidenceBundle(input)
  const externalToolReason = detectExternalToolEvidence(evidenceBundle.evidence)
  const blocked = Boolean(externalToolReason)
  const assertionResults = blocked
    ? input.request.assertions.map((assertion) => blockedAssertionResult(assertion, externalToolReason ?? 'External Tool evidence was detected.'))
    : input.request.assertions.map((assertion) => evaluateAssertion(assertion, evidenceBundle.evidence))
  const status = deriveReplayStatus(assertionResults, blocked)
  const receipt: AgentOpsReplayReceipt = {
    schemaVersion: 'agentops.replay-receipt.v1',
    receiptId: input.receiptId ?? `replay_${randomUUID()}`,
    generatedAt,
    status,
    mode: 'local_dry_run',
    agentId: input.agentId,
    draftAgentConfigId: input.draftAgentConfigId,
    source: {
      type: input.request.source.type,
      scenarioName: evidenceBundle.scenarioName,
    },
    toolSafety: {
      externalToolCalls: blocked,
      runtimeToolExecution: false,
      providerCalls: false,
      sideEffects: false,
      productionRuntimeReplay: false,
      scenarioReceiptsAppended: false,
      scenarioValidationMarkedValidated: false,
      reason: externalToolReason,
    },
    assertions: assertionResults,
    scenarioReceipt: evidenceBundle.scenarioReceipt,
    warnings: [],
  }

  return AgentOpsReplayReceiptSchema.parse(receipt)
}

function buildEvidenceBundle(input: BuildAgentOpsReplayReceiptInput): EvidenceBundle {
  if (input.request.source.type === 'scenario') {
    if (!input.scenario) {
      throw new Error(`Scenario "${input.request.source.name}" was not provided for local replay.`)
    }
    const receipt = runScenarioHarness(input.scenario, input.request.observed)
    return {
      scenarioName: input.scenario.name,
      evidence: receipt.evidence,
      scenarioReceipt: summarizeScenarioReceipt(receipt),
    }
  }

  return {
    scenarioName: input.request.source.scenario.name,
    evidence: scenarioObservedEvidenceSchema.parse(input.request.observed ?? {}),
    scenarioReceipt: null,
  }
}

function summarizeScenarioReceipt(receipt: ScenarioReceipt): AgentOpsReplayScenarioReceiptSummary {
  return {
    scenarioName: receipt.scenarioName,
    runId: receipt.runId,
    status: receipt.status,
    executionMode: 'fixture',
    toolExecutionMode: 'mocked',
    summary: receipt.summary,
    checkCount: receipt.checks.length,
    failureCount: receipt.failureReasons.length,
    validationStateChanged: false,
  }
}

function deriveReplayStatus(
  assertionResults: AgentOpsReplayAssertionResult[],
  blocked: boolean,
): AgentOpsReplayStatus {
  if (blocked) return 'blocked'
  return assertionResults.every((result) => result.passed) ? 'pass' : 'fail'
}

function evaluateAssertion(
  assertion: AgentOpsReplayAssertion,
  evidence: ScenarioObservedEvidence,
): AgentOpsReplayAssertionResult {
  switch (assertion.type) {
    case 'tool_input_equals':
      return evaluateToolInputEquals(assertion, evidence)
    case 'hook_outcome':
      return evaluateHookOutcome(assertion, evidence)
    default:
      return unreachableAssertion(assertion)
  }
}

function evaluateToolInputEquals(
  assertion: Extract<AgentOpsReplayAssertion, { type: 'tool_input_equals' }>,
  evidence: ScenarioObservedEvidence,
): AgentOpsReplayAssertionResult {
  const matchingCalls = evidence.toolCalls.filter((call) => call.name === assertion.toolName)
  const call = matchingCalls[assertion.callIndex]
  if (!call) {
    return {
      id: assertion.id,
      type: assertion.type,
      status: 'fail',
      passed: false,
      expected: assertion.expected,
      actual: null,
      evidenceRef: `toolCalls[${assertion.callIndex}]`,
      message: `Expected Tool call ${assertion.toolName} at index ${assertion.callIndex}.`,
    }
  }

  const actual = readPath(call.input, assertion.path)
  const passed = actual.found && isDeepStrictEqual(actual.value, assertion.expected)
  return {
    id: assertion.id,
    type: assertion.type,
    status: passed ? 'pass' : 'fail',
    passed,
    expected: assertion.expected,
    actual: actual.found ? actual.value : null,
    evidenceRef: `toolCalls[${assertion.callIndex}].input.${assertion.path}`,
    message: passed
      ? `Tool input ${assertion.toolName}.${assertion.path} matched.`
      : `Tool input ${assertion.toolName}.${assertion.path} did not match.`,
  }
}

function evaluateHookOutcome(
  assertion: Extract<AgentOpsReplayAssertion, { type: 'hook_outcome' }>,
  evidence: ScenarioObservedEvidence,
): AgentOpsReplayAssertionResult {
  const matchingHook = evidence.hookDecisions.find((hook) => {
    if (hook.hookName !== assertion.hookName) return false
    if (hook.decision !== assertion.decision) return false
    if (assertion.checkpoint && hook.checkpoint !== assertion.checkpoint) return false
    if (assertion.toolName && hook.toolName !== assertion.toolName) return false
    return true
  })
  const nearestHook = evidence.hookDecisions.find((hook) => hook.hookName === assertion.hookName) ?? null
  const passed = Boolean(matchingHook)

  return {
    id: assertion.id,
    type: assertion.type,
    status: passed ? 'pass' : 'fail',
    passed,
    expected: {
      hookName: assertion.hookName,
      checkpoint: assertion.checkpoint,
      toolName: assertion.toolName,
      decision: assertion.decision,
    },
    actual: matchingHook ?? nearestHook,
    evidenceRef: `hookDecisions.${assertion.hookName}`,
    message: passed
      ? `Hook ${assertion.hookName} produced ${assertion.decision}.`
      : `Hook ${assertion.hookName} did not produce ${assertion.decision}.`,
  }
}

function readPath(value: unknown, path: string): PathLookup {
  let current = value
  for (const segment of path.split('.')) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return { found: false }
      const index = Number(segment)
      if (index < 0 || index >= current.length) return { found: false }
      current = current[index]
      continue
    }
    if (!current || typeof current !== 'object') return { found: false }
    const record = current as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(record, segment)) return { found: false }
    current = record[segment]
  }
  return { found: true, value: current }
}

function detectExternalToolEvidence(evidence: ScenarioObservedEvidence): string | undefined {
  for (const [kind, rows] of [
    ['tool_call', evidence.toolCalls],
    ['tool_result', evidence.toolResults],
  ] as const) {
    for (const row of rows) {
      const reason = externalToolEvidenceReason(row as Record<string, unknown>)
      if (reason) return `${kind} ${row.name} ${reason}`
    }
  }
  return undefined
}

function externalToolEvidenceReason(row: Record<string, unknown>): string | undefined {
  if (row.executionMode === 'runtime') return 'uses runtime executionMode.'
  for (const key of EXTERNAL_TOOL_BOOLEAN_KEYS) {
    if (row[key] === true) return `sets ${key}=true.`
  }
  for (const key of EXTERNAL_TOOL_STRING_KEYS) {
    const value = row[key]
    if (typeof value !== 'string') continue
    const normalized = value.trim().toLowerCase()
    if (EXTERNAL_TOOL_STRING_INDICATORS.has(normalized)) return `sets ${key}=${value}.`
  }
  return undefined
}

function blockedAssertionResult(
  assertion: AgentOpsReplayAssertion,
  message: string,
): AgentOpsReplayAssertionResult {
  return {
    id: assertion.id,
    type: assertion.type,
    status: 'blocked',
    passed: false,
    expected: assertion.type === 'tool_input_equals'
      ? assertion.expected
      : { hookName: assertion.hookName, decision: assertion.decision },
    actual: null,
    message,
  }
}

function unreachableAssertion(assertion: never): AgentOpsReplayAssertionResult {
  throw new Error(`Unsupported AgentOps replay assertion: ${JSON.stringify(assertion)}`)
}
