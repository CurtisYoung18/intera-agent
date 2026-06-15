import { randomUUID } from 'node:crypto'
import {
  scenarioObservedEvidenceSchema,
  type SavedScenario,
  type ScenarioExpectedHookDecision,
  type ScenarioExpectedOutcome,
  type ScenarioObservedEvidence,
  type ScenarioObservedEvidenceInput,
  type ScenarioReceipt,
  type ScenarioReceiptCheck,
  type ScenarioReceiptFailureReason,
  type ScenarioReceiptStatus,
  type ScenarioExecutionMode,
  type ScenarioToolExecutionMode,
} from '@intera/shared/contracts/scenarios'

export interface ScenarioReceiptBuildOptions {
  executionMode?: ScenarioExecutionMode
  toolExecutionMode?: ScenarioToolExecutionMode
  startedAt?: string
  completedAt?: string
  statusOverride?: ScenarioReceiptStatus
  failureReasons?: ScenarioReceiptFailureReason[]
  traceId?: string
  summary?: string
}

export function runScenarioHarness(
  scenario: SavedScenario,
  observedInput?: ScenarioObservedEvidenceInput,
): ScenarioReceipt {
  return buildScenarioReceipt(scenario, buildFixtureEvidence(scenario, observedInput), {
    executionMode: 'fixture',
    toolExecutionMode: 'mocked',
  })
}

export function buildScenarioReceipt(
  scenario: SavedScenario,
  observedInput: ScenarioObservedEvidenceInput | undefined,
  options: ScenarioReceiptBuildOptions = {},
): ScenarioReceipt {
  const startedAt = new Date().toISOString()
  const completedAt = new Date().toISOString()
  const parsedEvidence = scenarioObservedEvidenceSchema.parse(observedInput ?? {})
  const procedureSummary = deriveProcedureSummary(parsedEvidence)
  const evidence = scenarioObservedEvidenceSchema.parse({
    ...parsedEvidence,
    procedureStatus: parsedEvidence.procedureStatus ?? procedureSummary.status,
    procedureOutcome: parsedEvidence.procedureOutcome ?? procedureSummary.outcome,
  })
  const checks = evaluateScenario(scenario.expected ?? {}, evidence)
  const failureReasons = [
    ...failureReasonsFromChecks(checks),
    ...(options.failureReasons ?? []),
  ]
  const status = options.statusOverride ?? (failureReasons.length > 0 ? 'fail' : 'pass')

  return {
    scenarioName: scenario.name,
    runId: `scn_${randomUUID()}`,
    status,
    executionMode: options.executionMode ?? 'fixture',
    toolExecutionMode: options.toolExecutionMode ?? 'mocked',
    startedAt: options.startedAt ?? startedAt,
    completedAt: options.completedAt ?? completedAt,
    finishedAt: options.completedAt ?? completedAt,
    agentConfigId: scenario.agentConfigId,
    scenarioVersion: scenario.updatedAt,
    summary: options.summary ?? summarizeChecks(checks, status),
    expected: scenario.expected ?? {},
    evidence,
    checks,
    failureReasons,
    traceId: options.traceId ?? evidence.traceId,
  }
}

export function evaluateScenario(
  expected: ScenarioExpectedOutcome,
  evidence: ScenarioObservedEvidence,
): ScenarioReceiptCheck[] {
  const checks: ScenarioReceiptCheck[] = []
  const procedureSummary = deriveProcedureSummary(evidence)

  if (expected.caseType) {
    checks.push({
      name: 'case_type',
      expected: expected.caseType,
      actual: evidence.caseType,
      passed: evidence.caseType === expected.caseType,
      code: evidence.caseType === expected.caseType ? undefined : 'case_type_mismatch',
      detail: evidence.caseType === expected.caseType
        ? undefined
        : `Expected CaseType ${expected.caseType}, saw ${evidence.caseType ?? 'none'}`,
    })
  }

  const expectedToolNames = [
    ...(expected.toolsCalled ?? []),
    ...(expected.toolCalls?.map((tool) => tool.name) ?? []),
  ]
  for (const toolName of [...new Set(expectedToolNames)]) {
    const actualCount = evidence.toolsCalled.filter((name) => name === toolName).length
    const expectedCall = expected.toolCalls?.find((tool) => tool.name === toolName)
    const minCalls = expectedCall?.minCalls ?? 1
    const maxCalls = expectedCall?.maxCalls
    const passed = actualCount >= minCalls && (maxCalls === undefined || actualCount <= maxCalls)
    checks.push({
      name: `tool:${toolName}`,
      expected: { name: toolName, minCalls, maxCalls },
      actual: { calls: actualCount },
      passed,
      code: passed ? undefined : (actualCount < minCalls ? 'required_tool_missing' : 'tool_call_count_mismatch'),
      detail: passed ? undefined : `Expected ${toolName} ${formatCallRange(minCalls, maxCalls)}, saw ${actualCount}`,
    })
  }

  for (const hook of expected.hooks ?? []) {
    const match = findHookDecision(hook, evidence.hookDecisions)
    checks.push({
      name: `hook:${hook.hookName}`,
      expected: hook,
      actual: match ?? null,
      passed: Boolean(match),
      code: match ? undefined : 'hook_decision_missing',
      detail: match ? undefined : `Expected Hook decision for ${hook.hookName}`,
    })
  }

  if (expected.humanTransfer !== undefined) {
    checks.push({
      name: 'human_transfer',
      expected: expected.humanTransfer,
      actual: evidence.humanTransfer,
      passed: evidence.humanTransfer === expected.humanTransfer,
      code: evidence.humanTransfer === expected.humanTransfer ? undefined : 'human_transfer_mismatch',
      detail: evidence.humanTransfer === expected.humanTransfer
        ? undefined
        : `Expected human transfer ${String(expected.humanTransfer)}, saw ${String(evidence.humanTransfer)}`,
    })
  }

  if (expected.finalStatus) {
    checks.push({
      name: 'final_status',
      expected: expected.finalStatus,
      actual: evidence.finalStatus,
      passed: evidence.finalStatus === expected.finalStatus,
      code: evidence.finalStatus === expected.finalStatus ? undefined : 'final_status_mismatch',
      detail: evidence.finalStatus === expected.finalStatus
        ? undefined
        : `Expected final status ${expected.finalStatus}, saw ${evidence.finalStatus ?? 'none'}`,
    })
  }

  if (expected.procedureStatus) {
    checks.push({
      name: 'procedure_status',
      expected: expected.procedureStatus,
      actual: procedureSummary.status,
      passed: procedureSummary.status === expected.procedureStatus,
      code: procedureSummary.status === expected.procedureStatus ? undefined : 'procedure_status_mismatch',
      detail: procedureSummary.status === expected.procedureStatus
        ? undefined
        : `Expected Procedure status ${expected.procedureStatus}, saw ${procedureSummary.status ?? 'none'}`,
    })
  }

  if (expected.procedureOutcome) {
    checks.push({
      name: 'procedure_outcome',
      expected: expected.procedureOutcome,
      actual: procedureSummary.outcome,
      passed: procedureSummary.outcome === expected.procedureOutcome,
      code: procedureSummary.outcome === expected.procedureOutcome ? undefined : 'procedure_outcome_mismatch',
      detail: procedureSummary.outcome === expected.procedureOutcome
        ? undefined
        : `Expected Procedure outcome ${expected.procedureOutcome}, saw ${procedureSummary.outcome ?? 'none'}`,
    })
  }

  const response = evidence.finalResponse ?? ''
  for (const phrase of expected.forbiddenPhrases ?? []) {
    const found = response.toLowerCase().includes(phrase.toLowerCase())
    checks.push({
      name: `forbidden_phrase:${phrase}`,
      expected: `not present: ${phrase}`,
      actual: found ? phrase : null,
      passed: !found,
      code: found ? 'forbidden_phrase_present' : undefined,
      detail: found ? `Forbidden phrase appeared: ${phrase}` : undefined,
    })
  }

  for (const phrase of expected.requiredPhrases ?? []) {
    const found = response.toLowerCase().includes(phrase.toLowerCase())
    checks.push({
      name: `required_phrase:${phrase}`,
      expected: `present: ${phrase}`,
      actual: found ? phrase : null,
      passed: found,
      code: found ? undefined : 'required_phrase_missing',
      detail: found ? undefined : `Required phrase missing: ${phrase}`,
    })
  }

  return checks
}

function buildFixtureEvidence(
  scenario: SavedScenario,
  observedInput?: ScenarioObservedEvidenceInput,
): ScenarioObservedEvidence {
  const expected = scenario.expected ?? {}
  const fallbackFinalResponse = [...scenario.turns].reverse().find((turn) => turn.role === 'assistant')?.content
    ?? (expected.humanTransfer ? 'This case needs human review based on the scenario boundary.' : 'Scenario harness completed.')
  const fallbackHookDecisions = (expected.hooks ?? []).map((hook) => ({
    hookName: hook.hookName,
    checkpoint: hook.checkpoint ?? 'Stop' as const,
    decision: hook.decision ?? 'allow' as const,
    reason: 'scenario harness expected decision',
  }))
  const fallbackHumanTransfer = expected.humanTransfer ?? false
  const fallbackHandoff = fallbackHumanTransfer
    ? [{ required: true, reason: 'scenario harness expected human transfer', target: 'human' }]
    : []

  return scenarioObservedEvidenceSchema.parse({
    caseType: expected.caseType,
    toolsCalled: [
      ...(expected.toolsCalled ?? []),
      ...(expected.toolCalls?.map((tool) => tool.name) ?? []),
    ],
    toolCalls: [
      ...(expected.toolsCalled ?? []),
      ...(expected.toolCalls?.map((tool) => tool.name) ?? []),
    ].map((name) => ({
      name,
      executionMode: 'mocked' as const,
    })),
    hookDecisions: fallbackHookDecisions,
    knowledgeHits: [],
    humanTransfer: fallbackHumanTransfer,
    handoff: fallbackHandoff,
    finalResponse: fallbackFinalResponse,
    finalStatus: expected.finalStatus ?? (fallbackHumanTransfer ? 'waiting_human' : 'completed'),
    procedureStatus: expected.procedureStatus,
    procedureOutcome: expected.procedureOutcome,
    ...observedInput,
  })
}

function deriveProcedureSummary(evidence: ScenarioObservedEvidence): {
  status?: string
  outcome?: string
} {
  const runs = evidence.runtime?.procedureRuns ?? []
  const latest = runs
    .slice()
    .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''))[0]
  return {
    status: evidence.procedureStatus ?? latest?.status,
    outcome: evidence.procedureOutcome ?? latest?.outcome,
  }
}

function failureReasonsFromChecks(checks: ScenarioReceiptCheck[]): ScenarioReceiptFailureReason[] {
  return checks
    .filter((check) => !check.passed)
    .map((check) => ({
      code: check.code ?? 'expectation_failed',
      message: check.detail ?? `Scenario expectation failed: ${check.name}`,
      checkName: check.name,
      expected: check.expected,
      actual: check.actual,
    }))
}

function findHookDecision(
  expected: ScenarioExpectedHookDecision,
  actual: ScenarioObservedEvidence['hookDecisions'],
): ScenarioObservedEvidence['hookDecisions'][number] | undefined {
  return actual.find((decision) => {
    if (decision.hookName !== expected.hookName) return false
    if (expected.checkpoint && decision.checkpoint !== expected.checkpoint) return false
    if (expected.decision && decision.decision !== expected.decision) return false
    return true
  })
}

function formatCallRange(minCalls: number, maxCalls: number | undefined): string {
  if (maxCalls === undefined) return `at least ${minCalls} time${minCalls === 1 ? '' : 's'}`
  if (minCalls === maxCalls) return `${minCalls} time${minCalls === 1 ? '' : 's'}`
  return `between ${minCalls} and ${maxCalls} times`
}

function summarizeChecks(checks: ScenarioReceiptCheck[], status: ScenarioReceiptStatus): string {
  if (status === 'blocked') return 'Runtime execution was blocked before Scenario expectations could be fully validated.'
  if (checks.length === 0) return 'No explicit expectations were defined.'
  const failures = checks.filter((check) => !check.passed)
  if (failures.length === 0) return `${checks.length} expectation${checks.length === 1 ? '' : 's'} passed.`
  return `${failures.length} of ${checks.length} expectation${checks.length === 1 ? '' : 's'} failed.`
}
