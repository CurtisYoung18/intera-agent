// Dry-run tool execution — single chokepoint for playground mode.
// Operational tools: mock. system_info tools: real execution allowed.
// Unknown/missing category → treated as operational (fail-safe).

import type { ToolExecutionResult } from './streaming-tool-executor'
import type { ToolDefinition } from '@intera/shared/types'

export type ToolCategory = 'system_info' | 'operational' | null

/** Check whether a tool is safe to execute in dry-run mode. */
export function isSafeInDryRun(skill: ToolDefinition): boolean {
  // system_info tools read data — safe to execute for real
  if ((skill as any).toolCategory === 'system_info') return true
  // Everything else (operational, null, undefined) → mock in dry-run
  return false
}

/** Produce a mock ToolExecutionResult for a dry-run intercepted tool. */
export function dryRunMockResult(skill: ToolDefinition): ToolExecutionResult {
  return {
    name: skill.name,
    latencyMs: 1,
    output: JSON.stringify({
      _dryRun: true,
      _note: `Playground dry-run: "${skill.name}" was intercepted. No external side effects.`,
      category: (skill as any).toolCategory ?? 'operational',
    }),
  }
}

/** MOCK result for dispatch_case_agent — compatibility wrapper for inline Procedure start. */
export function dispatchCaseAgentMockResult(caseType: string): ToolExecutionResult {
  return {
    name: 'dispatch_case_agent',
    latencyMs: 1,
    output: JSON.stringify({
      _dryRun: true,
      _note: `Playground: dispatch_case_agent(${caseType}) intercepted. Production starts/selects an inline Procedure; it does not spawn a background agent.`,
      procedureId: caseType,
      caseType,
      durableCaseCreated: false,
    }),
  }
}
