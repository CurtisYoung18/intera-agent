import type Anthropic from '@anthropic-ai/sdk'
import type { z } from 'zod'
import { ValidationError } from '@/lib/api/define-route'
import { createAgentClient } from '@/lib/agent/api/provider-config'
import { withRetry } from '@/lib/agent/api/with-retry'
import {
  configPilotPatchSchema,
  configPilotProposalSchema,
  type ConfigPilotContextResponse,
  type ConfigPilotProposal,
  type ConfigPilotProposeRequest,
} from './contracts'
import {
  CONFIG_PILOT_PROMPT_VERSION,
  CONFIG_PILOT_SYSTEM_PROMPT,
  CONFIG_PILOT_TOOL_NAME,
  CONFIG_PILOT_TOOL_SCHEMA,
} from './prompt'
import { buildProposalDiffGroups } from './proposal-diff'
import { selectConfigPilotModel } from './model-selection'
export { selectConfigPilotModel } from './model-selection'

function buildUserPrompt(input: ConfigPilotProposeRequest, context: ConfigPilotContextResponse): string {
  return JSON.stringify({
    operatorRequest: input.request,
    requestedTargetSurface: input.targetSurface ?? null,
    permissions: context.permissions,
    selectedAgent: context.selected,
    activeAgent: context.active,
    draftAgent: context.draft,
    lockedCapabilities: context.lockedCapabilities,
    validation: context.validation,
    currentConfiguration: context.configuration,
  }, null, 2)
}

function patchDiagnostics(rawProposal: unknown): string[] {
  const patches = rawProposal && typeof rawProposal === 'object'
    ? (rawProposal as { patches?: unknown }).patches
    : null
  if (!Array.isArray(patches)) return ['Proposal must contain a patches array.']

  return patches.flatMap((patch, index) => {
    const parsed = configPilotPatchSchema.safeParse(patch)
    if (parsed.success) return []
    const lines = [`patches.${index} failed typed patch validation.`]
    if (patch && typeof patch === 'object') {
      const candidate = patch as Record<string, unknown>
      const surface = candidate.surface
      const operation = candidate.operation
      lines.push(`patches.${index}.surface=${JSON.stringify(surface)} operation=${JSON.stringify(operation)}.`)
      const payload = candidate.value ?? candidate.fields
      if (surface === 'scenarios' && payload && typeof payload === 'object') {
        const scenario = payload as Record<string, unknown>
        if (typeof scenario.expected === 'string') {
          lines.push(`patches.${index}.expected is a string; it must be an object with typed checks such as humanTransfer, finalStatus, toolCalls, requiredPhrases, and forbiddenPhrases.`)
        }
        if (scenario.expected && typeof scenario.expected === 'object' && !Array.isArray(scenario.expected)) {
          const expected = scenario.expected as Record<string, unknown>
          if (Array.isArray(expected.hooks)) {
            expected.hooks.forEach((hook, hookIndex) => {
              if (typeof hook === 'string') {
                lines.push(`patches.${index}.expected.hooks.${hookIndex} is a string; hooks must be objects such as { "hookName": "${hook}", "checkpoint": "Stop", "decision": "escalate" }.`)
              }
            })
          }
        }
        if (Array.isArray(scenario.turns)) {
          scenario.turns.forEach((turn, turnIndex) => {
            const role = turn && typeof turn === 'object' ? (turn as Record<string, unknown>).role : null
            if (role !== 'user' && role !== 'assistant') {
              lines.push(`patches.${index}.turns.${turnIndex}.role must be user or assistant.`)
            }
            if (turn && typeof turn === 'object' && 'toolCalls' in (turn as Record<string, unknown>)) {
              lines.push(`patches.${index}.turns.${turnIndex} contains toolCalls; Scenario turns may contain only role/content/contentBlocks. Put expected tool usage in expected.toolCalls.`)
            }
          })
        }
      }
    }
    return lines
  })
}

function buildRepairPrompt(
  input: ConfigPilotProposeRequest,
  rawProposal: unknown,
  validationError: z.ZodError,
  attempt: number,
): string {
  return JSON.stringify({
    task: 'Repair the ConfigPilot proposal so it satisfies the allowed typed patch schema exactly.',
    repairAttempt: attempt,
    operatorRequest: input.request,
    requestedTargetSurface: input.targetSurface ?? null,
    validationErrors: formatZodIssues(validationError),
    patchDiagnostics: patchDiagnostics(rawProposal),
    invalidProposal: rawProposal,
    rules: [
      'Return exactly one record_configpilot_proposal tool call.',
      'Keep only allowed surfaces: brain, procedures, tools, hooks, hookBindings, knowledge, integrations, scenarios.',
      'Do not include publish, activate, deploy, rollback, validation bypass, runtime-managed capability edits, or raw secrets.',
      'If a desired change is not represented by an allowed typed patch, omit that patch and explain the limitation in safetyNotes.',
      'Every patch must use one of the exact surface/operation/value/target/fields shapes from the ConfigPilot system prompt.',
      'Scenario expected must be a JSON object with typed checks such as humanTransfer, finalStatus, requiredPhrases, forbiddenPhrases, toolsCalled, toolCalls, hooks, or caseType. Never put prose in expected.',
      'For Scenario requests, use one create patch whose value.expected is an object. Put narrative expectation text into description, rationale, receiptSuggestions, runSuggestions, requiredPhrases, or forbiddenPhrases instead.',
      'expected.hooks must be an array of objects with hookName plus optional checkpoint and decision. Never use an array of hook name strings.',
      'Scenario turns may include only role/content/contentBlocks. Do not put toolCalls or arguments inside turns; put expected tool usage in expected.toolCalls.',
    ],
  }, null, 2)
}

function extractToolInput(message: Anthropic.Messages.Message): unknown {
  for (const block of message.content) {
    if (block.type !== 'tool_use') continue
    const toolUse = block as { type: 'tool_use'; name?: string; input?: unknown }
    if (toolUse.name === CONFIG_PILOT_TOOL_NAME) return toolUse.input
  }
  return null
}

function extractJsonObjectFromText(value: string): unknown {
  const stripped = value
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(stripped.slice(start, end + 1))
  } catch {
    return null
  }
}

function extractTextJsonInput(message: Anthropic.Messages.Message): unknown {
  const chunks: string[] = []
  for (const block of message.content) {
    if (block.type !== 'text') continue
    const text = (block as { text?: unknown }).text
    if (typeof text === 'string') chunks.push(text)
  }
  const text = chunks.join('\n')
  if (!text.trim()) return null
  return extractJsonObjectFromText(text)
}

function formatZodIssues(error: z.ZodError): string[] {
  const lines: string[] = []
  const visit = (issue: z.ZodIssue, prefix = '') => {
    const path = issue.path.length ? issue.path.join('.') : '_root'
    const label = prefix ? `${path} ${prefix}` : path
    lines.push(`${label}: ${issue.message}`)
    const unionErrors = (issue as { errors?: z.ZodIssue[][] }).errors
    if (Array.isArray(unionErrors)) {
      unionErrors.forEach((branchIssues, branchIndex) => {
        branchIssues.forEach((branchIssue) => visit(branchIssue, `(union option ${branchIndex + 1})`))
      })
    }
  }
  error.issues.forEach((issue) => visit(issue))
  return lines
}

async function requestStructuredProposal(modelUsed: string, prompt: string): Promise<unknown> {
  const message = await withRetry(
    (retryClient, ctx) => retryClient.messages.create({
      model: ctx.model,
      max_tokens: ctx.maxTokensOverride ?? 3200,
      temperature: 0,
      system: CONFIG_PILOT_SYSTEM_PROMPT,
      tools: [{
        name: CONFIG_PILOT_TOOL_NAME,
        description: 'Record one typed ConfigPilot proposal for human review.',
        input_schema: CONFIG_PILOT_TOOL_SCHEMA as any,
      }],
      tool_choice: { type: 'tool', name: CONFIG_PILOT_TOOL_NAME } as any,
      messages: [{ role: 'user', content: prompt }],
      thinking: { type: 'disabled' as const },
    }),
    { querySource: 'main_loop', model: modelUsed, maxRetries: 2 },
    () => createAgentClient(modelUsed),
  ) as Anthropic.Messages.Message

  const structuredInput = extractToolInput(message) ?? extractTextJsonInput(message)
  if (!structuredInput || typeof structuredInput !== 'object') {
    throw new ValidationError('ConfigPilot model did not return a structured proposal')
  }
  return (structuredInput as { proposal?: unknown }).proposal ?? structuredInput
}

export async function proposeConfigPilotChange(
  input: ConfigPilotProposeRequest,
  context: ConfigPilotContextResponse,
): Promise<{ proposal: ConfigPilotProposal; modelUsed: string; promptVersion: string }> {
  const modelUsed = selectConfigPilotModel(context.selected.model)
  let rawProposal = await requestStructuredProposal(modelUsed, buildUserPrompt(input, context))
  let parsed = configPilotProposalSchema.safeParse(rawProposal)
  for (let repairAttempt = 1; !parsed.success && repairAttempt <= 2; repairAttempt += 1) {
    rawProposal = await requestStructuredProposal(modelUsed, buildRepairPrompt(input, rawProposal, parsed.error, repairAttempt))
    parsed = configPilotProposalSchema.safeParse(rawProposal)
  }
  if (!parsed.success) {
    throw new ValidationError('ConfigPilot proposal failed typed validation', {
      proposal: formatZodIssues(parsed.error).join('; '),
    })
  }

  const proposal: ConfigPilotProposal = {
    ...parsed.data,
    id: parsed.data.id ?? `configpilot_${Date.now()}`,
    baseDraftFingerprint: context.draftFingerprint,
    diffGroups: buildProposalDiffGroups(context, parsed.data),
  }

  return { proposal, modelUsed, promptVersion: CONFIG_PILOT_PROMPT_VERSION }
}
