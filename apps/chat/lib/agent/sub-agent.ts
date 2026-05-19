// Intera Harness - Sub-Agent
// Isolated investigator agent dispatched by the Orchestrator.
// Each sub-agent runs with its own model, prompt, and limited skill set,
// separate from the main agent loop. Supports multi-turn ReAct.

import Anthropic from '@anthropic-ai/sdk'
import type { Tool } from '@anthropic-ai/sdk/resources/index.mjs'
import type { SubAgentConfig, SubAgentTask, SubAgentResult, SkillDefinition, ToolUse } from '@intera/shared/types'
import { StreamingToolExecutor, unwrapToolExecutionPayload } from './streaming-tool-executor'

const DEFAULT_MAX_ITERATIONS = 5
const DEFAULT_TIMEOUT_MS = 30_000

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

  /** Run the sub-agent investigation with optional ReAct loop. */
  async investigate(task: SubAgentTask): Promise<SubAgentResult> {
    return this.investigateStreaming(task, () => {})
  }

  /** Run with progress events for real-time UI updates. */
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

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: task.taskPrompt },
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
            system: this.config.systemPrompt,
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

          for (const result of toolResults) {
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

            // Add tool result as assistant message for next iteration
            messages.push({
              role: 'assistant',
              content: JSON.stringify({ tool_call: result.name, result: payload }),
            })
          }

          // Add a continuation prompt
          messages.push({
            role: 'user',
            content: 'Continue based on tool results. If done, provide your findings and recommendation.',
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
