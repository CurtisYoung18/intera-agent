// S5 — ChannelRenderer interface.
// Each channel implements one renderer that translates canonical SSE events
// into channel-native actions.

import type { SSEEvent } from '../types'
import type { Channel, ChannelCapabilities } from './channel'
import type { ChannelBindingConfig } from './binding'
import type { RenderHint } from './render-hints'

export interface RenderContext {
  caseId: string
  customerId: string
  sessionId: string
  binding: ChannelBindingConfig
}

export interface ChannelRenderer<Action = unknown> {
  readonly channel: Channel
  readonly capabilities: ChannelCapabilities
  render(event: SSEEvent, ctx: RenderContext): Action[]
  init?(ctx: RenderContext): Promise<void>
  dispose?(ctx: RenderContext): Promise<void>
}

/** Resolution order: tool hint → binding override → binding default → undefined */
export function resolveHint(
  toolRenderHints: Partial<Record<Channel, RenderHint>> | undefined,
  channel: Channel,
  toolName: string,
  binding?: ChannelBindingConfig,
): RenderHint | undefined {
  // 1. Tool's own hint for this channel
  if (toolRenderHints?.[channel]) return toolRenderHints[channel]

  // 2. Operator's per-tool override in binding
  if (binding?.toolOverrides?.[toolName]) return binding.toolOverrides[toolName]

  // 3. Per-channel default for this hint kind (derive from first available)
  if (binding?.defaults?.card) return binding.defaults.card

  // 4. Fall back to renderer default
  return undefined
}
