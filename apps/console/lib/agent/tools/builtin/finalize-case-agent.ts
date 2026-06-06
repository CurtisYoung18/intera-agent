// Intera Harness - finalize_case_agent (Built-in Tool, S4 spec)
// Ported from sub-agent.ts FINALIZE_SUB_AGENT_SKILL + skills.ts built-in.
// Terminal tool for sub-agents — the ChecklistPolicy intercepts this to
// produce a SubAgentResult. No side effects in the call body itself.

import { z } from 'zod'
import type { Tool, ToolContext } from '@intera/shared/tools/tool'
import { registerBuiltin } from '@intera/shared/tools/tool'

// ── Input schema ───────────────────────────────────────────────────────────

const inputSchema = z.object({
  findings: z.array(
    z.object({
      key: z.string().describe('Fact key, e.g. "actualAmount", "channelStatus"'),
      value: z.unknown().describe('The discovered value for this key'),
    }),
  ).describe('Investigation findings as key-value pairs'),
  evidence: z.array(z.string()).optional()
    .describe('Evidence citations supporting the conclusions'),
  recommendation: z.string()
    .describe('Recommended next action for the orchestrator'),
})

type Input = z.infer<typeof inputSchema>

// ── Tool definition ────────────────────────────────────────────────────────

export const finalizeSubAgentTool: Tool<Input, Input> = {
  name: 'finalize_case_agent',
  source: 'builtin',
  guardPhase: 'post',
  isEnabled() { return true },
  isConcurrencySafe() { return false },
  isReadOnly() { return false },
  displayVerb: { text: 'Finalizing', icon: 'dots' },
  inputSchema,

  async prompt(_ctx: ToolContext): Promise<string> {
    return (
      '子代理完成任务后调用，将调查结果返回给主 Agent。调用后子代理循环终止。'
    )
  },

  async call(input: Input, _ctx: ToolContext): Promise<Input> {
    // Passthrough — the ChecklistPolicy / Orchestrator intercepts this tool
    // call to produce a SubAgentResult. The body simply returns the input
    // as output so the tool executor has a result to record.
    return input
  },
}

registerBuiltin(finalizeSubAgentTool)
