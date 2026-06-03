// ResolveBindings — drift detection for capability bindings.
// Shared helper used by the runtime loader, the SkillRouter, and the UI library pages.
//
// Takes a version's CapabilityBindings manifest and the active library,
// cross-references every name to detect what's still bound vs. what's gone missing.

import type { CapabilityBindings } from '@intera/shared/types'

/** The library of currently-existing items, keyed by name (skill)/type (case)/name (policy/knowledge). */
export interface CapabilityLibrary {
  /** Name → exists check for skills. */
  skillNames: Set<string>
  /** Type → exists check for case types. */
  caseTypeSlugs: Set<string>
  /** Name → exists check for policies. */
  policyNames: Set<string>
  /** Name → exists check for knowledge sources. */
  knowledgeNames: Set<string>
}

/** Result of resolving bindings against the library. */
export interface ResolvedCapabilityBindings {
  /** The bindings whose referenced items still exist. */
  bound: CapabilityBindings
  /** Names referenced in bindings that no longer exist in the library (drift). */
  missing: {
    guardrails: string[]
    tools: string[]
    caseTypes: string[]
    knowledge: string[]
  }
}

/**
 * Resolve a version's capability bindings against the current library.
 * Filters out any names that no longer exist in the library and reports them as drift.
 *
 * @param bindings - The version's CapabilityBindings manifest (from AgentConfig.capabilityBindings).
 * @param library  - The set of currently-existing items in each category.
 * @returns { bound, missing } — bound items still exist; missing items are drift.
 */
export function resolveBindings(
  bindings: CapabilityBindings,
  library: CapabilityLibrary,
): ResolvedCapabilityBindings {
  const bound: CapabilityBindings = {
    guardrails: { preTool: [], postTool: [], preFinalize: [] },
    tools: [],
    caseTypes: [],
    knowledge: [],
  }
  const missing = {
    guardrails: [] as string[],
    tools: [] as string[],
    caseTypes: [] as string[],
    knowledge: [] as string[],
  }

  // Guardrails — resolve each hook's policy names
  const allGuardrailNames: string[] = []
  for (const hook of ['preTool', 'postTool', 'preFinalize'] as const) {
    for (const name of bindings.guardrails[hook]) {
      allGuardrailNames.push(name)
      if (library.policyNames.has(name)) {
        bound.guardrails[hook].push(name)
      } else {
        missing.guardrails.push(name)
      }
    }
  }

  // Deduplicate guardrail missing names
  missing.guardrails = [...new Set(missing.guardrails)]

  // Tools
  for (const name of bindings.tools) {
    if (library.skillNames.has(name)) {
      bound.tools.push(name)
    } else {
      missing.tools.push(name)
    }
  }

  // Case types
  for (const type of bindings.caseTypes) {
    if (library.caseTypeSlugs.has(type)) {
      bound.caseTypes.push(type)
    } else {
      missing.caseTypes.push(type)
    }
  }

  // Knowledge sources
  for (const name of bindings.knowledge) {
    if (library.knowledgeNames.has(name)) {
      bound.knowledge.push(name)
    } else {
      missing.knowledge.push(name)
    }
  }

  return { bound, missing }
}

/** Convenience: check if any drift was detected. */
export function hasMissing(bindings: ResolvedCapabilityBindings): boolean {
  return (
    bindings.missing.guardrails.length > 0 ||
    bindings.missing.tools.length > 0 ||
    bindings.missing.caseTypes.length > 0 ||
    bindings.missing.knowledge.length > 0
  )
}

/** Format drift warnings as a human-readable string for trace/log output. */
export function formatDriftWarnings(missing: ResolvedCapabilityBindings['missing']): string {
  const parts: string[] = []
  if (missing.guardrails.length > 0) parts.push(`guardrails: [${missing.guardrails.join(', ')}]`)
  if (missing.tools.length > 0) parts.push(`tools: [${missing.tools.join(', ')}]`)
  if (missing.caseTypes.length > 0) parts.push(`caseTypes: [${missing.caseTypes.join(', ')}]`)
  if (missing.knowledge.length > 0) parts.push(`knowledge: [${missing.knowledge.join(', ')}]`)
  return parts.length > 0 ? `Capability drift detected — missing: ${parts.join('; ')}` : ''
}
