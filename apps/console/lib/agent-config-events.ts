'use client'

export const AGENT_CONFIG_UPDATED_EVENT = 'intera:agent-config-updated'

export function emitAgentConfigUpdated(agentId: string) {
  window.dispatchEvent(
    new CustomEvent(AGENT_CONFIG_UPDATED_EVENT, {
      detail: { agentId },
    }),
  )
}

