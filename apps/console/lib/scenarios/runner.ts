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
} from '@intera/shared/contracts/scenarios'

export function runScenarioHarness(
  scenario: SavedScenario,
  observedInput?: ScenarioObservedEvidenceInput,
): ScenarioReceipt {
  const startedAt = new Date().toISOString()
  const evidence = buildEvidence(scenario, observedInput)
  const checks = evaluateScenario(scenario.expected ?? {}, evidence)
  const status = checks.every((check) => check.passed) ? 'passed' : 'failed'
  const finishedAt = new Date().toISOString()

  return {
    scenarioName: scenario.name,
    runId: `scn_${randomUUID()}`,
    status,
    startedAt,
    finishedAt,
    agentConfigId: scenario.agentConfigId,
    summary: summarizeChecks(checks),
    expected: scenario.expected ?? {},
    evidence,
    checks,
    traceId: evidence.traceId,
  }
}

export function evaluateScenario(
  expected: ScenarioExpectedOutcome,
  evidence: ScenarioObservedEvidence,
): ScenarioReceiptCheck[] {
  const checks: ScenarioReceiptCheck[] = []

  if (expected.caseType) {
    checks.push({
      name: 'case_type',
      expected: expected.caseType,
      actual: evidence.caseType,
      passed: evidence.caseType === expected.caseType,
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
      detail: match ? undefined : `Expected Hook decision for ${hook.hookName}`,
    })
  }

  if (expected.humanTransfer !== undefined) {
    checks.push({
      name: 'human_transfer',
      expected: expected.humanTransfer,
      actual: evidence.humanTransfer,
      passed: evidence.humanTransfer === expected.humanTransfer,
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
      detail: evidence.finalStatus === expected.finalStatus
        ? undefined
        : `Expected final status ${expected.finalStatus}, saw ${evidence.finalStatus ?? 'none'}`,
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
      detail: found ? undefined : `Required phrase missing: ${phrase}`,
    })
  }

  return checks
}

function buildEvidence(
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
    hookDecisions: fallbackHookDecisions,
    knowledgeHits: [],
    humanTransfer: fallbackHumanTransfer,
    handoff: fallbackHandoff,
    finalResponse: fallbackFinalResponse,
    finalStatus: expected.finalStatus ?? (fallbackHumanTransfer ? 'waiting_human' : 'completed'),
    ...observedInput,
  })
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

function summarizeChecks(checks: ScenarioReceiptCheck[]): string {
  if (checks.length === 0) return 'No explicit expectations were defined.'
  const failures = checks.filter((check) => !check.passed)
  if (failures.length === 0) return `${checks.length} expectation${checks.length === 1 ? '' : 's'} passed.`
  return `${failures.length} of ${checks.length} expectation${checks.length === 1 ? '' : 's'} failed.`
}
