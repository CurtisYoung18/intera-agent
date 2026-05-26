// apps/chat/lib/livechat/types.ts

export type BridgeState =
  | 'idle'
  | 'thinking'
  | 'waiting_choice'
  | 'waiting_form'
  | 'transferred'

export interface BridgeSession {
  chatId: string
  customerId: string
  userId: string
  caseId: string
  state: BridgeState
  textBuffer: string
}

export interface LiveChatConfig {
  customerId: string
  botAccessToken: string
  licenseId: string
  showSkillStatus: boolean
  enabled: boolean
}

// intera_widget_payload variants
export type WidgetPayloadKind =
  | 'status_track'
  | 'propose_interaction'
  | 'request_user_input'

export interface StatusTrackStep {
  id: string           // tool/skill name
  label: string        // human-readable label
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
  options?: string[]   // for type=select
  placeholder?: string
}

export interface WidgetPayload {
  kind: WidgetPayloadKind
  caseId: string
  // status_track
  step?: StatusTrackStep
  // propose_interaction
  options?: InteractionOption[]
  // request_user_input
  fields?: FormField[]
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

// Bridge action descriptor returned by event-translators
export type BridgeAction =
  | { type: 'send_widget_payload'; payload: WidgetPayload }
  | { type: 'send_text'; text: string }
  | { type: 'send_quick_replies'; text: string; options: Array<{ id: string; label: string }> }
  | { type: 'transfer_chat'; caseId: string }
  | { type: 'update_chat_properties'; props: Record<string, string> }
  | { type: 'buffer_text'; delta: string }
  | { type: 'flush_text' }
  | { type: 'noop' }
