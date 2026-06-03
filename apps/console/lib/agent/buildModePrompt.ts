// Unified prompt assembly — single source of truth for both
// messages/route.ts and playground-runner.ts.
//
// Eliminates the dual-path drift where production and playground
// assembled core/case prompts independently.

import { CORE_SYSTEM_PROMPT, CASE_SYSTEM_PROMPT } from '@intera/shared/defaults'
import { resolvePrompt, buildPromptContext, type PromptContext } from './prompt-resolver'
import type { CaseSchemaConfig } from '@intera/shared/types'

export interface BuildModePromptInput {
  orgId: string

  /** Agent config from DB */
  coreSystemPrompt: string | null
  systemPrompt: string | null
  caseAddendum: string | null
  useLegacyCasePrompt: boolean | null

  /** Runtime context */
  hasActiveCase: boolean
  caseSchema: CaseSchemaConfig | null
  caseState: PromptContext['case_state']

  /** Prompt context data (passed through to buildPromptContext) */
  sessionBinding?: PromptContext['session_binding']
  availableTools?: PromptContext['available_tools']
}

export interface BuildModePromptOutput {
  /** The final assembled system prompt (ready for AgentLoop) */
  prompt: string
  /** Resolved base (core) prompt */
  basePrompt: string
  /** Resolved addendum (empty if no case or no addendum or legacy mode) */
  addendum: string
}

/**
 * Assemble the final system prompt for either core (discovery) or case (execution) mode.
 *
 * Legacy path (useLegacyCasePrompt === true):
 *   - Core mode: coreSystemPrompt (unchanged)
 *   - Case mode: systemPrompt (the old swap — entire case prompt replaces core)
 *
 * Base+append path (useLegacyCasePrompt === false):
 *   - Core mode: coreSystemPrompt
 *   - Case mode: coreSystemPrompt + caseAddendum (optional) + stage SOP appended later by case loop
 */
export async function buildModePrompt(input: BuildModePromptInput): Promise<BuildModePromptOutput> {
  const baseRaw = input.coreSystemPrompt?.trim() || CORE_SYSTEM_PROMPT

  // Build contexts
  const baseCtx = await buildPromptContext({
    orgId: input.orgId,
    caseSchema: null, // base doesn't include case schema
    caseState: null,
    sessionBinding: input.sessionBinding ?? null,
    available_tools: input.availableTools ?? [],
  })

  const basePrompt = resolvePrompt(baseRaw, baseCtx)
  const useLegacy = input.useLegacyCasePrompt !== false // null/default → legacy

  let prompt: string
  let addendum = ''

  if (!input.hasActiveCase) {
    // Discovery mode — always use core
    prompt = basePrompt
  } else if (useLegacy) {
    // Legacy: swap entire prompt to systemPrompt (case prompt)
    const caseRaw = input.systemPrompt?.trim() || CASE_SYSTEM_PROMPT
    const caseCtx = await buildPromptContext({
      orgId: input.orgId,
      caseSchema: input.caseSchema
        ? {
            displayName: input.caseSchema.displayName,
            goal: input.caseSchema.defaultGoal,
            stages: input.caseSchema.stages,
            requiredFacts: input.caseSchema.requiredFacts,
            escalateOn: input.caseSchema.escalateOn,
          }
        : null,
      caseState: input.caseState ?? null,
      sessionBinding: input.sessionBinding ?? null,
      available_tools: input.availableTools ?? [],
    })
    prompt = resolvePrompt(caseRaw, caseCtx)
  } else {
    // Base+append: core + optional addendum (stage SOP appended by case loop)
    const addendumRaw = input.caseAddendum?.trim() || ''
    if (addendumRaw) {
      const caseCtx = await buildPromptContext({
        orgId: input.orgId,
        caseSchema: null,
        caseState: input.caseState ?? null,
        sessionBinding: null,
        available_tools: [],
      })
      addendum = resolvePrompt(addendumRaw, caseCtx)
    }
    prompt = basePrompt + (addendum ? '\n\n' + addendum : '')
  }

  return { prompt, basePrompt, addendum }
}
