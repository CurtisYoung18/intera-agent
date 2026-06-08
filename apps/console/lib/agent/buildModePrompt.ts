// Unified prompt assembly — single source of truth for both
// messages/route.ts and playground-runner.ts.
//
// Eliminates the dual-path drift where production and playground
// assembled core/case prompts independently.
//
// Phase 1 (2026-06-08): System-managed injection blocks are now appended
// deterministically regardless of whether {{...}} tokens appear in the
// operator-authored prose. Operators edit prose only; the system owns
// the context blocks.

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
  /** Resolved base (core) prompt before deterministic injection */
  basePrompt: string
  /** Resolved addendum (empty if no case or no addendum or legacy mode) */
  addendum: string
}

/** Strip remaining {{...}} tokens from the prompt — system injects deterministically. */
function stripPlaceholders(text: string): string {
  return text.replace(/\s*\{\{[a-z_]+\}\}\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Ensure every required injection block is present in the prompt.
 * If a block (identified by its heading) is missing, append it.
 */
function ensureBlocks(prompt: string, blocks: Record<string, string>): string {
  let result = prompt
  for (const [, content] of Object.entries(blocks)) {
    if (!content) continue
    // Extract the heading line (first line of each block, e.g. "## Available Tools")
    const heading = content.split('\n')[0]
    if (!result.includes(heading)) {
      result = (result + '\n\n' + content).trim()
    }
  }
  return result
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
 *
 * Phase 1: All {{...}} tokens are stripped from operator prose; system-managed
 * injection blocks are appended deterministically regardless of token presence.
 */
export async function buildModePrompt(input: BuildModePromptInput): Promise<BuildModePromptOutput> {
  const baseRaw = input.coreSystemPrompt?.trim() || CORE_SYSTEM_PROMPT
  const useLegacy = input.useLegacyCasePrompt !== false

  // Build contexts
  const baseCtx = await buildPromptContext({
    orgId: input.orgId,
    caseSchema: null,
    caseState: null,
    sessionBinding: input.sessionBinding ?? null,
    available_tools: input.availableTools ?? [],
  })

  let prompt: string
  let addendum = ''

  if (!input.hasActiveCase) {
    // Discovery mode — token-resolve for backward compat, then deterministic injection
    prompt = resolvePrompt(baseRaw, baseCtx)
    prompt = stripPlaceholders(prompt)
    prompt = ensureBlocks(prompt, {
      tools: resolvePrompt('{{available_tools}}', baseCtx),
      caseTypes: resolvePrompt('{{case_types}}', baseCtx),
      sessionBinding: resolvePrompt('{{session_binding}}', baseCtx),
    })
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
    prompt = stripPlaceholders(prompt)
    prompt = ensureBlocks(prompt, {
      caseSchema: resolvePrompt('{{case_schema}}', caseCtx),
      caseState: resolvePrompt('{{case_state}}', caseCtx),
      policies: resolvePrompt('{{active_policies}}', caseCtx),
      sessionBinding: resolvePrompt('{{session_binding}}', caseCtx),
      tools: resolvePrompt('{{available_tools}}', caseCtx),
    })
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
      addendum = stripPlaceholders(addendum)
    }
    prompt = basePrompt(baseRaw, baseCtx)
    prompt = prompt + (addendum ? '\n\n' + addendum : '')

    // For case mode, also inject case-specific blocks
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
    prompt = ensureBlocks(prompt, {
      caseSchema: resolvePrompt('{{case_schema}}', caseCtx),
      caseState: resolvePrompt('{{case_state}}', caseCtx),
      policies: resolvePrompt('{{active_policies}}', caseCtx),
      sessionBinding: resolvePrompt('{{session_binding}}', caseCtx),
      tools: resolvePrompt('{{available_tools}}', caseCtx),
    })
  }

  return { prompt, basePrompt: stripPlaceholders(resolvePrompt(baseRaw, baseCtx)), addendum }
}

// Extracted for reuse in the base+append case path
function basePrompt(baseRaw: string, baseCtx: PromptContext): string {
  let prompt = resolvePrompt(baseRaw, baseCtx)
  prompt = stripPlaceholders(prompt)
  prompt = ensureBlocks(prompt, {
    tools: resolvePrompt('{{available_tools}}', baseCtx),
    caseTypes: resolvePrompt('{{case_types}}', baseCtx),
    sessionBinding: resolvePrompt('{{session_binding}}', baseCtx),
  })
  return prompt
}
