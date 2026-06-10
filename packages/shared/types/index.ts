// Intera Harness - Core Types
// Mirrors the architecture doc and Prisma schema

import type { Tool } from '@anthropic-ai/sdk/resources/index.mjs'

// ============================================
// Case Types
// ============================================

export type CaseStatus =
  | 'created'
  | 'collecting'
  | 'investigating'
  | 'waiting_human'
  | 'resolved'
  | 'escalated'

export type CaseType = string // e.g. "deposit_issue", "account_ban"

// ============================================
// Message Types
// ============================================

export type MessageRole = 'user' | 'assistant' | 'system'

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

export interface BaseMessage {
  id: string
  role: MessageRole
  content: string
  contentBlocks?: ContentBlock[]
  createdAt: Date
}

export interface UserMessage extends BaseMessage {
  role: 'user'
  attachments?: Attachment[]
}

export interface AssistantMessage extends BaseMessage {
  role: 'assistant'
  isStreaming?: boolean
  toolUses?: ToolUse[]
  thinking?: string
}

export interface SystemMessage extends BaseMessage {
  role: 'system'
}

export type Message = UserMessage | AssistantMessage | SystemMessage

export interface Attachment {
  id: string
  type: 'image' | 'file'
  name: string
  url?: string
  content?: string
}

// ============================================
// Tool Types
// ============================================

export interface ToolUse {
  id: string
  name: string
  input: Record<string, unknown>
  result?: ToolResult
  status?: 'pending' | 'executing' | 'completed' | 'error'
}

export interface ToolResult {
  ok: boolean
  output: unknown
  error?: string
  latencyMs: number
}

/** Spinner icon type used in the chat UI loading indicator. */
export type SpinnerIcon = 'dots' | 'pulse' | 'spin' | 'scan'

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Tool['input_schema']
  outputSchema?: Record<string, unknown>
  // Runtime config
  mode:
    | 'static_fixture'
    | 'http'
    | 'system_managed'
    | 'channel'
    | 'workflow'
    | 'code_transform'
  endpoint?: string
  httpMethod?: 'GET' | 'POST'
  headers?: Record<string, string>
  timeoutMs?: number
  staticFixture?: unknown
  /** @deprecated Legacy DB/runtime field; expose `staticFixture` in new contracts. */
  mockFixture?: unknown
  isConcurrencySafe: boolean
  enabled: boolean
  /** Category for tool access control: system_info tools are always available to the main agent;
   *  operational tools can be toggled per-console. Null = legacy (treated as operational). */
  toolCategory?: 'system_info' | 'operational'
  /** Customer-visible label shown in the chat spinner while this tool is executing.
   *  When absent, the tool name is formatted and used as a fallback. */
  displayVerb?: { text: string; icon: SpinnerIcon }
  /** Internal source mapping for generated knowledge-search tools. */
  knowledgeSourceId?: string
  knowledgeSourceName?: string
  // Zod validation — catches type errors at runtime, feeds back to LLM for correction
  // Pattern from Claude Code: tool.inputSchema.safeParse(input)
  zodSchema?: import('zod').ZodType
  /** Per-channel render hints for tool results (S5 — set by operator, consumed by ChannelRenderer). */
  renderHints?: {
    livechat?: import('../channels/render-hints').LivechatRenderHint
    'web-chat'?: import('../channels/render-hints').RenderHint
    [channel: string]: import('../channels/render-hints').RenderHint | import('../channels/render-hints').LivechatRenderHint | undefined
  }
}

// ============================================
// Case Memory (四层上下文)
// ============================================

export interface ChatMemoryData {
  caseId: string
  confirmedFacts: Record<string, unknown>
  missingFacts: string[]
  toolsCalled: string[]
  toolResults: Record<string, unknown>
  keyEvents: KeyEvent[]
  summary?: string
  caseStatus?: string
  todos?: TodoItem[]
}

// ============================================
// SOP Mode — Todo List
// ============================================

export interface TodoItem {
  id: string
  text: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  /** Who created this todo: 'agent' = runtime agent, 'procedure_init' = initial Procedure decomposition */
  addedBy: 'agent' | 'procedure_init'
  addedAt: string    // ISO timestamp
  completedAt?: string
  notes?: string
}

export interface TodoWriteInput {
  action: 'add' | 'update' | 'complete' | 'cancel'
  /** Required for update / complete / cancel */
  id?: string
  /** Required for add; optional for update */
  text?: string
  /** Optional notes / findings for this item */
  notes?: string
  /** Optional: set status explicitly on update (defaults applied for complete/cancel) */
  status?: TodoItem['status']
}

export interface KeyEvent {
  at: string // ISO timestamp
  text: string
  source: 'llm' | 'heuristic' | 'dashboard'
}

// ============================================
// Human Task Types
// ============================================

export type HumanTaskStatus = 'pending' | 'in_progress' | 'resolved'

export type Verdict =
  | 'confirmed_success'
  | 'needs_retry'
  | 'delayed_batch'
  | 'failed'
  | 'escalated'

export interface HumanTaskData {
  id: string
  caseId: string
  queue: string
  status: HumanTaskStatus
  question: string
  verdict?: Verdict
  expectedEta?: string
  notes?: string
  createdAt: Date
  resolvedAt?: Date
}

// ============================================
// Agent Config Types
// ============================================

export interface AgentConfigData {
  model: string
  temperature: number
  thinkingBudget: number
  maxIterations: number
  maxOutputTokens?: number
  /** Core/discovery prompt (no active case). Falls back to CORE_SYSTEM_PROMPT default when empty. */
  coreSystemPrompt?: string
  extendedThinking: boolean
  memoryStrategy: MemoryStrategy
  resumePrompt?: string
  /** Fallback model to use when the primary model is overloaded (consecutive 529s). */
  fallbackModel?: string
}

export interface MemoryStrategy {
  // ── Retention ──
  l1MaxMessages: number
  l2SummaryMaxTokens: number
  l4MaxHistoricalCases: number
  keyEventExtractionPrompt: string
  maxRecentTraces: number
  caseRetentionDays: number

  // ── Compaction thresholds ──
  autocompactThresholdTokens: number
  warningThresholdTokens: number
  errorThresholdTokens: number
  blockingThresholdTokens: number


  // ── Compaction thresholds (ratio-based — preferred, percentage of context window used) ──
  /** Compact when used / window >= autocompactRatio (default 0.70, i.e. 70% of context window used). */
  autocompactRatio?: number
  /** Warn when used / window >= warningRatio (default 0.60, i.e. 60% of context window used). */
  warningRatio?: number
  /** Must compact when used / window >= blockingRatio (default 0.92, i.e. 92% of context window used). */
  blockingRatio?: number
  /** If set, trigger compaction every N user messages regardless of token threshold. undefined = disabled. */
  compactEveryNMessages?: number
  // ── Compaction features ──
  compactModel: string
  /** Model used for L3 cross-chat profile compaction (compactUserProfile).
   *  Falls back to compactModel when unset. */
  profileModel?: string
  enableSnip?: boolean
  enableMicrocompact?: boolean
  microcompactMinAgeMs?: number
  enableContextCollapse?: boolean
  enableAutocompact?: boolean

  // ── Chat Memory ──
  enableChatMemory?: boolean
  chatMemoryMaxTokens?: number

  // ── Compaction fine-tuning ──
  compactMaxMessages: number
  compactTemperature: number
  compactMaxTokensCap: number
  compactMinSummaryLength: number
  compactionKeepMin: number
  compactionKeepRatio: number
  compactableTools: string[]

  // ── Fact extraction (LLM-based, replaces regex patterns) ──
  factExtractionPrompt?: string
  factExtractionModel?: string
  keyEventMaxChars: number

  // ── Token estimation ──
  tokensPerKeyEvent: number
  tokensPerFact: number
  tokensPerTool: number
  cjkCharPerToken: number
  latinCharPerToken: number
  minTokenEstimate: number
  toolResultTokenRatio: number

  // ── Advanced ──
  compactPrompt: string
  contextWindow?: number
  outputTokensReserved?: number
  maxKeyEventsAfterCompact?: number
  compactCircuitBreakerMaxFailures?: number
  sessionMemoryMaxAgeMs?: number
  toolResultTemplate?: string
}

// ============================================
// SSE Event Types
// ============================================

export type SSEEventType =
  | 'stream_request_start'
  | 'thinking_delta'
  | 'text_delta'
  | 'tool_executing'
  | 'tool_progress'
  | 'tool_call'
  | 'tool_result'
  | 'memory_update'
  | 'case_status'
  | 'human_task_created'
  | 'form_request'
  | 'finalized'
  | 'message_stop'
  | 'withheld'
  | 'consultation_complete'
  | 'case_created'
  | 'core_agent_progress'
  | 'hook_blocked'
  | 'retry_pending'
  | 'session_init'
  | 'escalated'
  | 'trace'
  | 'llm_request_start'
  | 'llm_response'
  | 'error'

/** Option presented in an interaction card. */
export interface InteractionOption {
  id: string
  label: string
  description?: string
  inputType?: 'none' | 'text' | 'number'
  inputPlaceholder?: string
}

/** Canonical error payload for SSE `error` events. */
export interface SSEErrorData { code: string; message: string }

/** Lifecycle notices the playground renders as system bubbles. */
export type LifecycleKind = 'escalated' | 'case_created' | 'human_task' | 'retry'
export interface LifecycleNotice { kind: LifecycleKind; label: string; detail?: string }

export interface SSEEvent {
  type: SSEEventType
  data: unknown
  timestamp: string
}

// ============================================
// Case Schema (动态状态机)
// ============================================

export interface CaseSchemaConfig {
  type: CaseType
  displayName: string
  description?: string
  icon: string
  requiredFacts: string[]
  defaultGoal: string
  escalateOn: string[]
  autoCloseConditions?: Record<string, unknown>
  /** Ordered Procedure executed by the single main agent. When present, the case runs the Procedure path. */
  procedure?: Procedure
  /** Safety bound on auto-continuation turns. */
  maxAutoTurns?: number
}

// ============================================
// Procedure (single-agent ordered SOP — Procedure refactor)
// ============================================

/**
 * One closed, operator-legible action vocabulary for a Procedure step.
 *   use      — call a tool                       (target = tool name)
 *   read     — gather data (read-only tool/KB/memory/prior case)
 *   ask      — collect from the customer         (target = form/field set)
 *   decide   — natural-language branch point     (when carries the condition)
 *   tag      — label the case/customer           (target = tag value)
 *   escalate — hand to a human                   (target = queue)
 *   finalize — close the case                    (target? = 'resolved' | 'consultation')
 */
export type ProcedureAction =
  | 'use'
  | 'read'
  | 'ask'
  | 'decide'
  | 'tag'
  | 'escalate'
  | 'finalize'

export interface ProcedureStep {
  /** Stable, unique within the procedure. */
  id: string
  action: ProcedureAction
  /** Typed by action (tool name / source / tag / queue …). */
  target?: string
  /** Per-step natural-language instruction. */
  guidance?: string
  /** Optional NL precondition ("only if balance unchanged"). */
  when?: string
  /** Feeds the completion check and HookBinding derivation. */
  required?: boolean
}

export interface Procedure {
  /** Ordered; the agent follows but may adapt (skip when false, reorder if evidence present, loop back). */
  steps: ProcedureStep[]
}

// ============================================
// API Response Types
// ============================================

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface MessagesResponse {
  messages: Message[]
  caseId: string
  caseStatus: CaseStatus
  transition?: TransitionReason
}

export type TransitionReason =
  | 'next_turn'
  | 'collapse_drain_retry'
  | 'reactive_compact_retry'
  | 'max_output_tokens_escalate'

export interface LoopResult {
  messages: Message[]
  caseStatus: CaseStatus
  transition: TransitionReason
  currentStage?: string
  reason?: string
}

// ============================================
// Intent Classification
// ============================================

export interface MatchedCaseType {
  type: string
  displayName: string
  icon: string
  confidence: number
}

export interface IntentClassification {
  intent: 'qa' | 'case'
  matchedCaseTypes: MatchedCaseType[]
  needsClarification: boolean
  reasoning: string
  extractedFacts: Record<string, string>
  modelUsed?: string
}
