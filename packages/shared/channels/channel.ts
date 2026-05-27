// S5 — Channel abstraction.
// Makes the agent generic and channel-pluggable.

export type Channel = 'web-chat' | 'livechat' | 'slack' | 'discord' | 'whatsapp'

export interface ChannelCapabilities {
  richCards: boolean
  maxButtonsPerCard: number | null
  markdown: boolean
  forms: boolean
  streaming: boolean
  maxMessageChars: number | null
  attachments: boolean
  typingIndicator: boolean
}

export const CHANNEL_CAPS: Record<Channel, ChannelCapabilities> = {
  'web-chat': { richCards: true, maxButtonsPerCard: null, markdown: true, forms: true, streaming: true, maxMessageChars: null, attachments: true, typingIndicator: true },
  'livechat': { richCards: true, maxButtonsPerCard: 11, markdown: true, forms: false, streaming: false, maxMessageChars: 4000, attachments: true, typingIndicator: true },
  'slack':   { richCards: true, maxButtonsPerCard: 5, markdown: false, forms: true, streaming: false, maxMessageChars: 3000, attachments: true, typingIndicator: false },
  'discord': { richCards: true, maxButtonsPerCard: 5, markdown: true, forms: false, streaming: false, maxMessageChars: 2000, attachments: true, typingIndicator: false },
  'whatsapp': { richCards: false, maxButtonsPerCard: 3, markdown: false, forms: false, streaming: false, maxMessageChars: 1024, attachments: true, typingIndicator: false },
}
