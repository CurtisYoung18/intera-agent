import type { Tool } from '@anthropic-ai/sdk/resources/index.mjs'
import type { Message, LoopResult, SubAgentResult, ToolResult } from '@intera/shared/types'

// ── ExecutionPolicy ─────────────────────────────────────────────

export interface ExecutionPolicy {
  /** 组装系统提示词 */
  buildPrompt(basePrompt: string): string

  /** 过滤可用工具 */
  filterTools(allTools: Tool[], iteration: number): Tool[]

  /** 判断循环是否继续 / 过渡 / 终止 */
  evaluateContinuation(
    lastMessage: Message,
    toolResults: ToolResult[],
    iteration: number,
  ): ContinueDecision | Promise<ContinueDecision>

  /** 处理终端工具，返回是否截获 */
  handleTerminalTool(toolName: string, input: unknown): TerminalToolResult | null
}

// ── ContinueDecision ────────────────────────────────────────────

export type ContinueDecision =
  | { action: 'continue' }
  | { action: 'transition'; nextStage: string }
  | { action: 'complete_task'; result: SubAgentResult }
  | { action: 'stop'; reason: string; isError?: boolean }

// ── TerminalToolResult ──────────────────────────────────────────

export type TerminalToolResult =
  | { type: 'handled'; result: LoopResult }
  | { type: 'not_handled' }
