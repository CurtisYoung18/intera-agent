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

export interface BaseMessage {
  id: string
  role: MessageRole
  content: string
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
// Tool / Skill Types
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

export interface SkillDefinition {
  name: string
  description: string
  inputSchema: Tool['input_schema']
  outputSchema?: Record<string, unknown>
  // Runtime config
  mode: 'mock' | 'http'
  endpoint?: string
  httpMethod?: 'GET' | 'POST'
  headers?: Record<string, string>
  timeoutMs?: number
  mockFixture?: unknown
  isConcurrencySafe: boolean
  enabled: boolean
  // Zod validation — catches type errors at runtime, feeds back to LLM for correction
  // Pattern from Claude Code: tool.inputSchema.safeParse(input)
  zodSchema?: import('zod').ZodType
}

// ============================================
// Case Memory (四层上下文)
// ============================================

export interface CaseMemoryData {
  caseId: string
  confirmedFacts: Record<string, unknown>
  missingFacts: string[]
  skillsCalled: string[]
  skillResults: Record<string, unknown>
  keyEvents: KeyEvent[]
  summary?: string
  caseStatus?: string
}

export interface KeyEvent {
  at: string // ISO timestamp
  text: string
  source: 'llm' | 'heuristic'
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
// Policy Types
// ============================================

export type PolicyHook = 'preTool' | 'postTool' | 'preFinalize'
export type PolicyResult = 'pass' | 'blocked' | 'hint' | 'escalated'

export interface PolicyRule {
  deny_skills?: string[]
  /** All listed skills must have been called before finalize_case */
  require_skills?: string[]
  /** At least one listed skill must have been called before finalize_case */
  require_skills_any?: string[]
  min_evidence_count?: number
  evidence_sources?: string[]
  /** Natural-language evaluation prompt for LLM-based policy checks (replaces keyword/regex matching) */
  evaluationPrompt?: string
}

export interface PolicyCheck {
  name: string
  hook: PolicyHook
  result: PolicyResult
  reason?: string
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
  systemPrompt: string
  toolParallelism: boolean
  isConcurrencySafe: boolean
  showThinking: boolean
  memoryStrategy: MemoryStrategy
  policyHooks: PolicyHooks
  resumePrompt?: string
  formResponseTemplate?: string
  evaluationModel?: string
  intentModel?: string

  /**
   * DeepSeek beta chat completions — **customer-side composer** drafting assist only (`/api/composer-assist/*`).
   * Field names are legacy; they do not alter the main agent / tool loop.
   */
  prefixContinuationEnabled?: boolean
  /** DeepSeek Chat model id (e.g. deepseek-chat). */
  prefixContinuationChatModel?: string
  /** Beta base URL, e.g. https://api.deepseek.com/beta */
  prefixContinuationBaseUrl?: string
  /** Optional extra instructions appended to the fixed composer system prompt (accessibility, tone). */
  prefixContinuationAssistantPrefix?: string
  /** JSON-encoded string[] optional `stop` sequences for the completion API. */
  prefixContinuationStop?: string
  /** Min draft characters before composer continuation runs (default 4). */
  prefixContinuationMinDraftChars?: number
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

  // ── Compaction features ──
  compactModel: string
  enableSnip?: boolean
  enableMicrocompact?: boolean
  enableContextCollapse?: boolean
  enableAutocompact?: boolean

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
  keyEventMaxChars: number

  // ── Token estimation ──
  tokensPerKeyEvent: number
  tokensPerFact: number
  tokensPerSkill: number
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

export interface PolicyHooks {
  preTool: string[]
  postTool: string[]
  preFinalize: string[]
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
  | 'skill_call'
  | 'skill_result'
  | 'memory_update'
  | 'case_status'
  | 'human_task_created'
  | 'form_request'
  | 'finalized'
  | 'message_stop'
  | 'withheld'
  | 'consultation_complete'
  | 'intent_classified'
  | 'case_created'
  | 'sub_agent_start'
  | 'sub_agent_progress'
  | 'sub_agent_complete'
  | 'sub_agent_error'
  | 'core_agent_progress'
  | 'clarification'
  | 'error'

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
  stages: string[]
  stageConfigs?: Record<string, StageConfig>
  defaultGoal: string
  escalateOn: string[]
  autoCloseConditions?: Record<string, unknown>
  orchestrator?: OrchestratorConfig
}

// ============================================
// Stage Configuration (per-stage)
// ============================================

export interface StageConfig {
  name: string
  description?: string
  model?: string
  systemPrompt?: string
  temperature?: number
  thinkingBudget?: number
  requiredSkills?: string[]
  availableSkills?: string[]
  guardrails?: StageGuardrail[]
  evidenceRequirements?: EvidenceRequirement[]
  transition?: StageTransitionRule
  subAgents?: SubAgentConfig[]
}

export interface StageGuardrail {
  name: string
  description?: string
  hook: PolicyHook
  rule: PolicyRule
}

export interface EvidenceRequirement {
  factKey: string
  description: string
  source: 'user_input' | 'skill_output' | 'evaluation'
  skillName?: string
  required: boolean
}

export interface StageTransitionRule {
  type: 'auto' | 'evaluation' | 'manual'
  conditions?: StageTransitionCondition[]
  evaluationModel?: string
  evaluationPrompt?: string
}

export interface StageTransitionCondition {
  type: 'all_evidence_gathered' | 'all_skills_called' | 'min_iterations' | 'llm_decision'
  value?: number | string | boolean
}

// ============================================
// Sub-Agent Configuration
// ============================================

export interface SubAgentConfig {
  name: string
  model: string
  systemPrompt: string
  skills: string[]
  taskTemplate: string
  maxIterations?: number
  parallel: boolean
}

export interface OrchestratorConfig {
  enabled: boolean
  dispatchPrompt?: string
  maxParallelAgents?: number
}

export interface SubAgentTask {
  id: string
  agentConfig: SubAgentConfig
  taskPrompt: string
  context: {
    caseId: string
    caseMemory: CaseMemoryData
    stageGoal: string
  }
}

export interface SubAgentResult {
  taskId: string
  agentName: string
  /** Parent case — for split UI / SSE routing */
  caseId: string
  findings: Record<string, unknown>
  evidence: Record<string, unknown>[]
  recommendation?: string
  tokensUsed: number
  durationMs: number
}

/** Unified notification format for sub-agent lifecycle (CC `<task-notification>` pattern). */
export interface SubAgentNotification {
  taskId: string
  agentId: string
  agentName: string
  caseId: string
  status: 'started' | 'running' | 'completed' | 'failed'
  stage?: string
  findings?: Record<string, unknown>
  recommendation?: string
  tokensUsed?: number
  durationMs?: number
  error?: string
  timestamp: string
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
  | 'stage_continue'

export interface LoopResult {
  messages: Message[]
  caseStatus: CaseStatus
  transition: TransitionReason
  currentStage?: string
  reason?: string
  pendingSubAgents?: string[]
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
