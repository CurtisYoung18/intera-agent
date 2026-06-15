// Unified prompt assembly — single source of truth for both
// messages/route.ts and playground-runner.ts.
//
// Phase 5 (2026-06-08): Legacy swap path removed. Single base+Procedure path.
// System-managed injection blocks are appended deterministically regardless
// of {{...}} token presence. Operators edit prose only.

import { CORE_SYSTEM_PROMPT } from '@intera/shared/defaults'
import { resolvePrompt, buildPromptContext, type PromptContext } from './prompt-resolver'
import type { CaseSchemaConfig } from '@intera/shared/types'

export interface BuildModePromptInput {
  agentConfigId: string

  /** Operator-authored core/discovery prompt (no tokens needed). */
  coreSystemPrompt: string | null

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
  /** Resolved core prompt before deterministic injection */
  basePrompt: string
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
    const heading = content.split('\n')[0]
    if (!result.includes(heading)) {
      result = (result + '\n\n' + content).trim()
    }
  }
  return result
}

/**
 * Assemble the final system prompt for core (discovery) or case (execution) mode.
 *
 * Single path (Phase 5): coreSystemPrompt + Procedure prompt (appended by case loop).
 * Legacy swap (systemPrompt), caseAddendum, and useLegacyCasePrompt are removed.
 * All {{...}} injection blocks are system-managed.
 */
export async function buildModePrompt(input: BuildModePromptInput): Promise<BuildModePromptOutput> {
  const baseRaw = input.coreSystemPrompt?.trim() || CORE_SYSTEM_PROMPT

  const baseCtx = await buildPromptContext({
    agentConfigId: input.agentConfigId,
    caseSchema: null,
    caseState: null,
    sessionBinding: input.sessionBinding ?? null,
    available_tools: input.availableTools ?? [],
  })

  // Always start from core prompt with discovery injection blocks
  let prompt = resolvePrompt(baseRaw, baseCtx)
  prompt = stripPlaceholders(prompt)
  prompt = ensureBlocks(prompt, {
    tools: resolvePrompt('{{available_tools}}', baseCtx),
    caseTypes: resolvePrompt('{{case_types}}', baseCtx),
    sessionBinding: resolvePrompt('{{session_binding}}', baseCtx),
  })

  // When a case is active, additionally inject case-specific blocks
  if (input.hasActiveCase) {
    const caseCtx = await buildPromptContext({
      agentConfigId: input.agentConfigId,
      caseSchema: input.caseSchema
        ? {
            displayName: input.caseSchema.displayName,
            goal: input.caseSchema.defaultGoal,
            requiredFacts: input.caseSchema.requiredFacts,
            escalateOn: input.caseSchema.escalateOn,
          }
        : null,
      caseState: input.caseSchema?.procedure ? null : (input.caseState ?? null),
      sessionBinding: input.sessionBinding ?? null,
      available_tools: input.availableTools ?? [],
    })
    prompt = ensureBlocks(prompt, {
      caseSchema: resolvePrompt('{{case_schema}}', caseCtx),
      caseState: resolvePrompt('{{case_state}}', caseCtx),
      hooks: resolvePrompt('{{active_hooks}}', caseCtx),
    })
  }

  return { prompt, basePrompt: prompt }
}
