// S5 — Channel binding config per (customerId, channel).
// Operators configure which channels are active and per-tool overrides.

import type { RenderHint } from './render-hints'
import type { Channel } from './channel'

export interface ChannelBindingConfig {
  channel: Channel
  enabled: boolean
  credentials: unknown
  toolOverrides?: Record<string, RenderHint>
  defaults?: { plain?: RenderHint; card?: RenderHint; form?: RenderHint }
  channelSkillBinding?: string[]
}
