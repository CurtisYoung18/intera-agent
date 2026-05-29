// apps/chat/lib/livechat/types.ts

export type BridgeState =
  | 'idle'
  | 'thinking'
  | 'waiting_choice'
  | 'waiting_form'
  | 'transferred'

export interface BridgeSession {
  chatId: string
  vendorId: string
  userId: string
  caseId: string
  state: BridgeState
  textBuffer: string
}

export interface LiveChatConfig {
  vendorId: string
  botAccessToken: string
  licenseId: string
  webhookSecret?: string
  region?: string
  authType?: 'bearer' | 'basic' | 'auto'
  accountId?: string
  agentAccountId?: string
  showSkillStatus: boolean
  enabled: boolean
  transferGroupId?: number
  transferMessage?: string
}

// intera_widget_payload variants
export type WidgetPayloadKind =
  | 'status_track'
  | 'propose_interaction'
  | 'request_user_input'
  | 'skill_render'

export interface StatusTrackStep {
  id: string
  label: string
  state: 'running' | 'done'
  durationMs?: number
}

export interface InteractionOption {
  id: string
  label: string
  description?: string
  inputType?: 'none' | 'text'
  inputPlaceholder?: string
}

export interface FormField {
  id: string
  type: 'text' | 'number' | 'select' | 'textarea' | 'file' | 'date'
  label: string
  required?: boolean
  options?: string[]
  placeholder?: string
}

export interface WidgetPayload {
  kind: WidgetPayloadKind
  caseId: string
  step?: StatusTrackStep
  options?: InteractionOption[]
  fields?: FormField[]
  template?: string
  data?: unknown
  skill?: string
}

// Events sent from In-Chat App back to Bridge via LiveChat send_event
export interface InteraInteractionSubmit {
  caseId: string
  optionId: string
  input?: string
}

export interface InteraFormSubmit {
  caseId: string
  answers: Record<string, string>
}

// Content block for multimodal messages (Anthropic-compatible)
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

// Attachment data from file events
export interface AttachmentData {
  url: string
  contentType: string
  filename: string
}

// Incoming event types from webhook → bridge
export type IncomingEvent =
  | { type: 'message'; text?: string }
  | { type: 'form_submit'; form?: InteraFormSubmit }
  | { type: 'interaction_submit'; interaction?: InteraInteractionSubmit }
  | { type: 'attachment'; attachment: AttachmentData }
  | { type: 'postback'; postbackId: string }
  | { type: 'chat_archived' }

// Card spec for send_card / send_carousel
export interface CardSpec {
  title: string
  subtitle?: string
  imageUrl?: string
  buttons: Array<{
    id: string
    label: string
    type?: 'message' | 'url' | 'webview'
    url?: string
  }>
}

// Bridge action descriptor returned by renderers
export type BridgeAction =
  | { type: 'send_widget_payload'; payload: WidgetPayload }
  | { type: 'send_text'; text: string }
  | { type: 'send_quick_replies'; text: string; options: Array<{ id: string; label: string }> }
  | { type: 'send_card'; card: CardSpec }
  | { type: 'send_carousel'; cards: CardSpec[] }
  | { type: 'send_image'; url: string; caption?: string }
  | { type: 'send_system_message'; text: string }
  | { type: 'set_typing'; isTyping: boolean }
  | { type: 'transfer_chat'; caseId: string; group?: number }
  | { type: 'update_chat_properties'; props: Record<string, string> }
  | { type: 'buffer_text'; delta: string }
  | { type: 'flush_text' }
  | { type: 'noop' }
