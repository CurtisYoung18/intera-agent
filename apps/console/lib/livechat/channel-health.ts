// Stub channel-health module — ChannelHealth table was removed during agent-scoped refactor.
// Bridge.ts calls are already guarded with .catch(() => {}), so no-ops are safe.

export type HealthStatus = 'healthy' | 'token_expired' | 'rate_limited' | 'unreachable'

export async function markChannelUnhealthy(
  _orgId: string,
  _channel: string,
  _status: HealthStatus,
  _error?: string,
): Promise<void> {
  // no-op: ChannelHealth table removed
}

export async function markChannelHealthy(_orgId: string, _channel: string): Promise<void> {
  // no-op: ChannelHealth table removed
}

export async function getChannelHealth(
  _orgId: string,
  _channel: string,
): Promise<{
  status: HealthStatus
  lastChecked: Date
  lastError: string | null
} | null> {
  return null
}
