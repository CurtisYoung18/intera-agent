// Shared AgentConfig loader — used by messages/route.ts and playground-runner.ts.
// Single source of truth for DB → AgentConfigData mapping.

import { prisma } from '@intera/shared/prisma'
import { getCachedConfig, setCachedConfig } from '@/lib/agent/config-cache'
import {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_MODEL,
  DEFAULT_MEMORY_STRATEGY,
  DEFAULT_POLICY_HOOKS,
} from '@intera/shared/defaults'
import type { AgentConfigData, CapabilityBindings } from '@intera/shared/types'

function parseNonEmptyJson(raw: string): Record<string, unknown> | null {
  try {
    const p = JSON.parse(raw)
    if (p && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).length > 0) return p
  } catch { /* ignore */ }
  return null
}

const DEFAULT_AGENT_CONFIG: AgentConfigData = {
  model: DEFAULT_MODEL,
  temperature: 0.5,
  thinkingBudget: 4096,
  maxIterations: 20,
  maxOutputTokens: 4096,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  showThinking: false,
  memoryStrategy: { ...DEFAULT_MEMORY_STRATEGY },
  policyHooks: { ...DEFAULT_POLICY_HOOKS },
  resumePrompt: '',
}

/**
 * Parse capabilityBindings from a DB JSON string.
 * Returns undefined if the column is null or the JSON is invalid,
 * signalling callers to fall back to policyHooks + global enabled.
 */
function parseBindings(raw: string | null | undefined): CapabilityBindings | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        guardrails: {
          preTool: Array.isArray(parsed.guardrails?.preTool) ? parsed.guardrails.preTool : [],
          postTool: Array.isArray(parsed.guardrails?.postTool) ? parsed.guardrails.postTool : [],
          preFinalize: Array.isArray(parsed.guardrails?.preFinalize) ? parsed.guardrails.preFinalize : [],
        },
        tools: Array.isArray(parsed.tools) ? parsed.tools : [],
        caseTypes: Array.isArray(parsed.caseTypes) ? parsed.caseTypes : [],
        knowledge: Array.isArray(parsed.knowledge) ? parsed.knowledge : [],
      }
    }
  } catch { /* ignore */ }
  return undefined
}

export async function loadAgentConfig(
  orgId: string,
  agentConfigId?: string | null,
): Promise<AgentConfigData> {
  const cached = getCachedConfig(orgId, agentConfigId ?? undefined)
  if (cached) return cached

  try {
    const dbConfig = agentConfigId
      ? await prisma.agentConfig.findUnique({ where: { id: agentConfigId } })
      : await prisma.agentConfig.findFirst({ where: { orgId, name: 'Default', isActive: true } })

    if (dbConfig) {
      const r = dbConfig as Record<string, unknown>
      const config: AgentConfigData = {
        model: dbConfig.model,
        temperature: dbConfig.temperature,
        thinkingBudget: dbConfig.thinkingBudget,
        maxIterations: dbConfig.maxIterations,
        maxOutputTokens: (r.maxOutputTokens as number) ?? 4096,
        systemPrompt: dbConfig.systemPrompt || DEFAULT_SYSTEM_PROMPT,
        coreSystemPrompt: r.coreSystemPrompt ? String(r.coreSystemPrompt) : undefined,
        showThinking: dbConfig.showThinking,
        memoryStrategy:
          (parseNonEmptyJson(dbConfig.memoryStrategy) as unknown as AgentConfigData['memoryStrategy']) ||
          DEFAULT_AGENT_CONFIG.memoryStrategy,
        policyHooks:
          (parseNonEmptyJson(dbConfig.policyHooks) as unknown as AgentConfigData['policyHooks']) ||
          DEFAULT_AGENT_CONFIG.policyHooks,
        capabilityBindings: parseBindings(r.capabilityBindings as string | null),
        resumePrompt: r.resumePrompt ? String(r.resumePrompt) : '',
        debugMode: Boolean(r.debugMode),
        invariantCheck: Boolean(r.invariantCheck),
      }
      setCachedConfig(orgId, config, agentConfigId ?? undefined)
      return config
    }
  } catch (err) {
    console.warn('[Intera] Failed to load agent config from DB, using default:', err)
  }

  return { ...DEFAULT_AGENT_CONFIG }
}
