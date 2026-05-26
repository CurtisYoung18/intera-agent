// Intera Harness - Sub-Agent
// Isolated investigator agent dispatched by the Orchestrator.
// Each sub-agent runs with its own model, prompt, and limited skill set,
// separate from the main agent loop. Supports multi-turn ReAct.

import Anthropic from '@anthropic-ai/sdk'
import type { Tool } from '@anthropic-ai/sdk/resources/index.mjs'
import type { SubAgentConfig, SubAgentTask, SubAgentResult, SkillDefinition, ToolUse, AgentContext, SSEEvent } from '@intera/shared/types'
import { StreamingToolExecutor, unwrapToolExecutionPayload } from './streaming-tool-executor'
import { ChecklistPolicy } from './policies/checklist-policy'
import { AgentLoop } from './loop'

const DEFAULT_MAX_ITERATIONS = 5
const DEFAULT_TIMEOUT_MS = 30_000

/** Terminal tool for sub-agents — intercepted by ChecklistPolicy, never executed. */
const FINALIZE_SUB_AGENT_SKILL: SkillDefinition = {
  name: 'finalize_sub_agent',
  description:
    'Call this when you have completed all required investigation checks. ' +
    'Returns your findings, evidence, and recommendation to the orchestrator. ' +
    'Calling this tool ends the sub-agent loop.',
  inputSchema: {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        items: { type: 'object', properties: { key: { type: 'string' }, value: {} } },
        description: 'Investigation findings as key-value pairs.',
      },
      evidence: {
        type: 'array',
        items: { type: 'string' },
        description: 'Evidence citations supporting the conclusions.',
      },
      recommendation: {
        type: 'string',
        description: 'Recommended next action for the orchestrator.',
      },
    },
    required: ['findings', 'recommendation'],
  },
  mode: 'mock',
  isConcurrencySafe: false,
  enabled: true,
}

export interface SubAgentProgressEvent {
  type: 'thinking' | 'tool_call' | 'tool_result'
  agentName: string
  detail?: string
  toolName?: string
}

export class SubAgent {
  private client: Anthropic

  constructor(
    private config: SubAgentConfig,
    private skillDefinitions: SkillDefinition[] = [],
  ) {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
      baseURL: process.env.ANTHROPIC_BASE_URL,
    })
  }

  /**
   * Run the sub-agent investigation using the unified AgentLoop.runReActLoop().
   *
   * Creates a ChecklistPolicy from `ctx.allowedTools` and `ctx.taskChecklist`,
   * then delegates all ReAct iteration to the shared loop engine. The policy
   * intercepts `finalize_sub_agent` to produce a SubAgentResult.
   */
  async run(ctx: AgentContext, task: SubAgentTask): Promise<SubAgentResult> {
    const startTime = Date.now()

    // ── Build skill definitions including the terminal tool ────────
    const allSkills = [...this.skillDefinitions, FINALIZE_SUB_AGENT_SKILL]

    // ── Build ChecklistPolicy ──────────────────────────────────────
    const allowedTools = new Set(ctx.allowedTools)
    allowedTools.add('finalize_sub_agent')

    const policy = new ChecklistPolicy({
      allowedTools,
      taskChecklist: ctx.taskChecklist
        ? {
            goal: ctx.taskChecklist.goal,
            requiredChecks: ctx.taskChecklist.requiredChecks,
            outputFormat: ctx.taskChecklist.outputFormat,
            rules: ctx.taskChecklist.rules,
          }
        : undefined,
    })

    // ── Run unified ReAct loop ─────────────────────────────────────
    const noopSendEvent = (_event: SSEEvent) => {}

    const loopResult = await AgentLoop.runReActLoop(
      this.client,
      this.config.systemPrompt,
      allSkills,
      ctx,
      policy,
      noopSendEvent,
      task.taskPrompt,
    )

    // ── Extract SubAgentResult from policy ─────────────────────────
    const durationMs = Date.now() - startTime
    const policyResult = policy.getSubAgentResult()

    if (policyResult) {
      return {
        ...policyResult,
        taskId: task.id,
        agentName: this.config.name,
        caseId: task.context.caseId,
        durationMs,
      }
    }

    // Fallback: policy didn't produce a result (e.g. max iterations)
    return {
      taskId: task.id,
      agentName: this.config.name,
      caseId: task.context.caseId,
      findings: {},
      evidence: [],
      recommendation: loopResult.reason ?? 'Investigation completed',
      tokensUsed: 0,
      durationMs,
    }
  }

  /** @deprecated Use run(ctx, task) instead — delegates to the unified AgentLoop.runReActLoop(). */
  async investigate(task: SubAgentTask): Promise<SubAgentResult> {
    return this.investigateStreaming(task, () => {})
  }

  /** @deprecated Use run(ctx, task) instead — delegates to the unified AgentLoop.runReActLoop(). */
  async investigateStreaming(
    task: SubAgentTask,
    onProgress: (event: SubAgentProgressEvent) => void,
  ): Promise<SubAgentResult> {
    const startTime = Date.now()
    const maxIterations = this.config.maxIterations || DEFAULT_MAX_ITERATIONS
    const tools = this.buildTools()
    const allFindings: Record<string, unknown> = {}
    const allEvidence: Record<string, unknown>[] = []
    let recommendation: string | undefined
    let totalTokens = 0
    const abortController = new AbortController()

    // ── Fork cache: reuse shared system prompt across same-type parallel agents ──
    const fc = task.forkContext
    const systemPrompt = fc?.sharedSystemPrompt ?? this.config.systemPrompt
    const promptPrefix = fc
      ? `[FORK:${fc.chainId}] batch ${fc.batchIndex + 1}/${fc.batchSize}\n\n`
      : ''

    // Anthropic requires typed content blocks — use `any` to allow both
    // string (first user turn) and structured block arrays (tool turns).
    const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [
      { role: 'user', content: promptPrefix + task.taskPrompt },
    ]

    try {
      for (let iter = 0; iter < maxIterations; iter++) {
        const remainingMs = Math.max(0, DEFAULT_TIMEOUT_MS - (Date.now() - startTime))
        const timeoutId = setTimeout(() => {
          abortController.abort()
        }, remainingMs)

        let msg: Anthropic.Messages.Message
        try {
          msg = await this.client.messages.create({
            model: this.config.model,
            max_tokens: 2048,
            temperature: 0.3,
            system: systemPrompt,
            tools: tools.length > 0 ? tools : undefined,
            messages: messages as any,
          }, {
            signal: abortController.signal,
          })
        } catch (err) {
          clearTimeout(timeoutId)
          if (abortController.signal.aborted) {
            throw new Error(`Sub-agent ${this.config.name} timed out`)
          }
          throw err
        }
        clearTimeout(timeoutId)

        const usage = (msg as any).usage || {}
        totalTokens += (usage.input_tokens || 0) + (usage.output_tokens || 0)

        let textContent = ''
        const toolUses: ToolUse[] = []

        for (const block of msg.content) {
          if (block.type === 'text') {
            textContent += (block as any).text
          } else if (block.type === 'tool_use') {
            toolUses.push({
              id: (block as any).id,
              name: (block as any).name,
              input: (block as any).input || {},
            })
          }
        }

        onProgress({
          type: 'thinking',
          agentName: this.config.name,
          detail: textContent.slice(0, 200),
        })

        // Execute tools via shared StreamingToolExecutor
        if (toolUses.length > 0) {
          for (const tu of toolUses) {
            onProgress({
              type: 'tool_call',
              agentName: this.config.name,
              toolName: tu.name,
              detail: `Calling ${tu.name}`,
            })
          }

          const toolResults = await StreamingToolExecutor.executeAll(this.skillDefinitions, toolUses)

          // ── Correct Anthropic tool-use multi-turn format ──────────────────
          // 1. Assistant message: the full content blocks from the API response
          //    (includes both text blocks and tool_use blocks)
          messages.push({
            role: 'assistant',
            content: msg.content,
          })

          // 2. User message: one tool_result block per tool call
          //    Must use the exact tool_use_id from the assistant's tool_use block.
          const toolResultBlocks = toolResults.map((result) => {
            const payload = unwrapToolExecutionPayload(result.output)

            onProgress({
              type: 'tool_result',
              agentName: this.config.name,
              toolName: result.name,
              detail: JSON.stringify(payload).slice(0, 200),
            })

            if (payload && typeof payload === 'object') {
              Object.assign(allFindings, payload as Record<string, unknown>)
            }
            allEvidence.push({
              source: result.name,
              result: payload,
              latencyMs: result.latencyMs,
            })

            // tool_use_id must match the id from the assistant's tool_use block.
            // Fall back to matching by name in toolUses if toolUse isn't set
            // (happens when Zod validation fails — toolUse isn't attached to the result).
            const toolUseId =
              result.toolUse?.id ??
              toolUses.find((tu) => tu.name === result.name)?.id ??
              ''

            return {
              type: 'tool_result' as const,
              tool_use_id: toolUseId,
              content: JSON.stringify(payload),
            }
          })

          messages.push({
            role: 'user',
            content: toolResultBlocks,
          })
        } else {
          // No tools called — agent is done
          const findings = this.parseFindings(textContent, allFindings, allEvidence)
          Object.assign(allFindings, findings.facts)
          allEvidence.push(...findings.evidence)
          recommendation = findings.recommendation
          break
        }
      }

      const durationMs = Date.now() - startTime
      return {
        taskId: task.id,
        agentName: this.config.name,
        caseId: task.context.caseId,
        findings: allFindings,
        evidence: allEvidence,
        recommendation: recommendation || 'Investigation completed',
        tokensUsed: totalTokens,
        durationMs,
      }
    } catch (err) {
      const durationMs = Date.now() - startTime
      console.error(`[SubAgent:${this.config.name}] Investigation failed:`, err)
      return {
        taskId: task.id,
        agentName: this.config.name,
        caseId: task.context.caseId,
        findings: { error: String(err), ...allFindings },
        evidence: allEvidence,
        recommendation: undefined,
        tokensUsed: totalTokens,
        durationMs,
      }
    }
  }

  /** Build Anthropic tool definitions from skill definitions. */
  private buildTools(): Tool[] {
    if (!this.config.skills?.length) return []

    const allowedSkills = new Set(this.config.skills)
    const tools: Tool[] = []

    for (const skill of this.skillDefinitions) {
      if (allowedSkills.has(skill.name) && skill.enabled) {
        tools.push({
          name: skill.name,
          description: skill.description,
          input_schema: skill.inputSchema as Tool['input_schema'],
        })
      }
    }

    return tools
  }

  /** Parse findings from sub-agent text response and collected tool results. */
  private parseFindings(
    text: string,
    collectedFacts: Record<string, unknown>,
    collectedEvidence: Record<string, unknown>[],
  ): {
    facts: Record<string, unknown>
    evidence: Record<string, unknown>[]
    recommendation?: string
  } {
    const facts: Record<string, unknown> = { ...collectedFacts }
    const evidence = [...collectedEvidence]

    // Try to parse structured JSON from text
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        if (parsed.findings) Object.assign(facts, parsed.findings)
        if (parsed.recommendation) {
          return { facts, evidence, recommendation: parsed.recommendation }
        }
      } catch { /* not JSON */ }
    }

    // Extract recommendation from text
    const recMatch = text.match(/recommendation[：:]\s*(.+?)(?:\n|$)/i)
    const recommendation = recMatch ? recMatch[1].trim() : undefined

    return { facts, evidence, recommendation }
  }
}
