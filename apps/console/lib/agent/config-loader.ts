// Shared AgentConfig loader — used by messages/route.ts and playground-runner.ts.
// Single source of truth for DB → AgentConfigData mapping.
//
// Phase 5 (2026-06-08): systemPrompt, debugMode, invariantCheck columns dropped.
// showThinking renamed to extendedThinking.

import { prisma } from '@intera/shared/prisma'
import { getCachedConfig, setCachedConfig } from '@/lib/agent/config-cache'
import {
  DEFAULT_MODEL,
  DEFAULT_MEMORY_STRATEGY,
} from '@intera/shared/defaults'
import type { AgentConfigData } from '@intera/shared/types'

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
  extendedThinking: false,
  memoryStrategy: { ...DEFAULT_MEMORY_STRATEGY },
  resumePrompt: '',
}

export async function loadAgentConfig(
  agentConfigId?: string | null,
): Promise<AgentConfigData> {
  const scopedAgentConfigId = typeof agentConfigId === 'string' && agentConfigId.trim().length > 0
    ? agentConfigId.trim()
    : null
  const cached = getCachedConfig(scopedAgentConfigId ?? undefined)
  if (cached) return cached
  if (!scopedAgentConfigId) {
    const fallback = { ...DEFAULT_AGENT_CONFIG }
    setCachedConfig(undefined, fallback)
    return fallback
  }

  try {
    const dbConfig = await prisma.agentConfig.findUnique({ where: { id: scopedAgentConfigId } })

    if (dbConfig) {
      const r = dbConfig as Record<string, unknown>
      const config: AgentConfigData = {
        model: dbConfig.model,
        temperature: dbConfig.temperature,
        thinkingBudget: dbConfig.thinkingBudget,
        maxIterations: dbConfig.maxIterations,
        maxOutputTokens: (r.maxOutputTokens as number) ?? 4096,
        coreSystemPrompt: r.coreSystemPrompt ? String(r.coreSystemPrompt) : undefined,
        extendedThinking: dbConfig.extendedThinking ?? false,
        memoryStrategy:
          (parseNonEmptyJson(dbConfig.memoryStrategy) as unknown as AgentConfigData['memoryStrategy']) ||
          DEFAULT_AGENT_CONFIG.memoryStrategy,
        resumePrompt: r.resumePrompt ? String(r.resumePrompt) : '',
      }
      setCachedConfig(scopedAgentConfigId, config)
      return config
    }
  } catch (err) {
    console.warn('[Intera] Failed to load agent config from DB, using default:', err)
  }

  return { ...DEFAULT_AGENT_CONFIG }
}
