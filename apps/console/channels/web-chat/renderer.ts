// apps/chat/channels/web-chat/renderer.ts
// S5 Phase 5b — Web-chat renderer scaffold.
// The web-chat client already handles SSE events directly; this renderer is a
// thin passthrough for interface conformance. Render-hint application added in 5c.

import type { ChannelRenderer, RenderContext } from '@intera/shared/channels/renderer'
import { CHANNEL_CAPS } from '@intera/shared/channels/channel'
import type { Channel } from '@intera/shared/channels/channel'
import type { SSEEvent } from '@intera/shared/types'

/** A passthrough action that wraps the canonical SSE event as-is. */
export interface WebChatAction {
  type: 'passthrough'
  event: SSEEvent
}

export class WebChatRenderer implements ChannelRenderer<WebChatAction> {
  readonly channel: Channel = 'web-chat'
  readonly capabilities = CHANNEL_CAPS['web-chat']

  render(event: SSEEvent, _ctx: RenderContext): WebChatAction[] {
    return [{ type: 'passthrough', event }]
  }
}
