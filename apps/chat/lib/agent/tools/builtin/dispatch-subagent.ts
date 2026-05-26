// Intera Harness - dispatch_subagent (Built-in Tool, S4 spec)
// New built-in for cc/Adaptive mode. Allows the main agent to dispatch
// sub-agents at runtime through the Orchestrator.

import { z } from 'zod'
import type { Tool, ToolContext } from '@intera/shared/tools/tool'
import { registerBuiltin } from '@intera/shared/tools/tool'

// ── Input schema ───────────────────────────────────────────────────────────

const inputSchema = z.object({
  agentName: z.string()
    .describe('Name of the sub-agent to dispatch (e.g. "order_verifier", "payment_channel_checker")'),
  taskDescription: z.string()
    .describe('Short human-readable description of what this sub-agent should investigate'),
  taskPrompt: z.string()
    .describe('Detailed task prompt with investigation instructions for the sub-agent'),
})

type Input = z.infer<typeof inputSchema>

// ── Tool definition ────────────────────────────────────────────────────────

export const dispatchSubagentTool: Tool<Input, unknown> = {
  name: 'dispatch_subagent',
  source: 'builtin',
  guardPhase: 'pre',
  isEnabled() { return true },
  isConcurrencySafe() { return false },
  isReadOnly() { return false },
  displayVerb: { text: 'Dispatching specialist', icon: 'pulse' },
  inputSchema,

  async prompt(): Promise<string> {
    // ── Dynamically list available sub-agents ─────────────────────────────
    // TODO: When the sub-agent registry is built, query CaseType stageConfigs
    // for the list of registered sub-agent names. For now return a static
    // description.
    return (
      'Dispatch a specialist sub-agent to investigate a specific aspect of the case. ' +
      'Available sub-agents are defined in the case type\'s stage configuration. ' +
      'The sub-agent will run independently with its own model and tools, then return ' +
      'findings via finalize_sub_agent.\n\n' +
      'Available types (typical):\n' +
      '  - order_verifier — verify order/transaction details with the payment platform\n' +
      '  - payment_channel_checker — check payment channel status and settlement delays\n' +
      '  - account_inspector — inspect account status, KYC, and restrictions\n'
    )
  },

  async call(input: Input, ctx: ToolContext): Promise<unknown> {
    if (!ctx.orchestrator) {
      throw new Error(
        'dispatch_subagent requires an orchestrator, but none is available in the current context. ' +
        'This tool can only be used when the case type has orchestrator enabled.'
      )
    }

    const caseId = ctx.caseMemory?.caseId
    if (!caseId) {
      throw new Error('dispatch_subagent requires an active case (caseMemory.caseId is missing).')
    }

    return ctx.orchestrator.dispatch(input.agentName, {
      description: input.taskDescription,
      taskPrompt: input.taskPrompt,
      caseId,
    })
  },
}

registerBuiltin(dispatchSubagentTool)
