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

/** Spinner icon type used in the chat UI loading indicator. */
export type SpinnerIcon = 'dots' | 'pulse' | 'spin' | 'scan'

export interface SkillDefinition {
  name: string
  description: string
  inputSchema: Tool['input_schema']
  outputSchema?: Record<string, unknown>
  // Runtime config
  mode: 'static' | 'http' | 'engine_managed' | 'channel'
  endpoint?: string
  httpMethod?: 'GET' | 'POST'
  headers?: Record<string, string>
  timeoutMs?: number
  mockFixture?: unknown
  isConcurrencySafe: boolean
  enabled: boolean
  /** Customer-visible label shown in the chat spinner while this skill is executing.
   *  When absent, the skill name is formatted and used as a fallback. */
  displayVerb?: { text: string; icon: SpinnerIcon }
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
  skillsCalled: string[]
  skillResults: Record<string, unknown>
  keyEvents: KeyEvent[]
  summary?: string
  caseStatus?: string
  todos?: TodoItem[]
  /** Per-agent todo lists. Key is agent name (e.g. "order_verifier"). */
  agentTodos?: Record<string, TodoItem[]>
  dashboardVersion?: number
}

// ============================================
// Shared Dashboard — versioned state for sub-agent polling
// ============================================

export interface DashboardChange {
  /** Version that triggered this change notification. */
  dashboardVersion: number
  /** Facts added or modified since the last known version. */
  changedFacts: Record<string, unknown>
  /** Keys of facts that were removed. */
  removedFactKeys: string[]
  /** Per-agent todo changes keyed by agent name. */
  agentTodoChanges: Record<string, TodoItem[]>
  /** Key events added since the last known version. */
  newKeyEvents: KeyEvent[]
}

// ============================================
// SOP Mode — Todo List
// ============================================

export interface TodoItem {
  id: string
  text: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  /** Who created this todo: 'agent' = Core/SOP agent, 'sop_init' = initial SOP decomposition */
  addedBy: 'agent' | 'sop_init'
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
// Policy Types
// ============================================

export type PolicyHook = 'preTool' | 'postTool' | 'preFinalize'
export type PolicyResult = 'pass' | 'blocked' | 'hint' | 'escalated'

export interface PolicyRule {
  /** Block specific skills by exact name match (preTool only) */
  deny_skills?: string[]
  /** All listed skills must have been called before finalize_case */
  require_skills?: string[]
  /** At least one listed skill must have been called before finalize_case */
  require_skills_any?: string[]
  /** postTool only: only evaluate this policy when these skills were called in the iteration. Empty = all tools. */
  hook_skills?: string[]
  /** Enable LLM-based evaluation. When false, only exact-match rules (deny/require) apply. Default true. */
  enableLlm?: boolean
  /** Natural-language evaluation prompt for LLM-based policy checks.
   * Supports placeholders: {{skill_name}} {{skill_output}} {{confirmed_facts}} {{skills_called}} */
  evaluationPrompt?: string
}

export interface PolicyCheckResult {
  policyName: string
  result: PolicyResult
  reason?: string
  modelUsed?: string
}

/** Aggregate result for all policies evaluated at a single checkpoint. */
export interface PolicyEvaluationResult {
  hook: PolicyHook
  results: PolicyCheckResult[]
  /** The most severe result across all policies in this batch. */
  summary: PolicyResult
  /** Human-readable feedback ready to inject into the agent's message stream. */
  feedbackMessage?: string
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
  /** Core/discovery prompt (no active case). Falls back to CORE_SYSTEM_PROMPT default when empty. */
  coreSystemPrompt?: string
  showThinking: boolean
  memoryStrategy: MemoryStrategy
  policyHooks: PolicyHooks
  resumePrompt?: string
  formResponseTemplate?: string
  /** JSON array of skill names available to human operator during consultation. */
  humanSkills?: string
  /** Custom consultation system prompt override (human-chat route). */
  consultationPrompt?: string
  evaluationModel?: string
  /** When enabled, writes full API request/response payloads to debug-logs/<caseId>/ for troubleshooting. */
  debugMode?: boolean
  /** When enabled, runs an LLM eval after each stream turn to detect and strip leaked model-context (think blocks, tool-result echoes). */
  enableLlmSanitization?: boolean
  /** When enabled, asserts the S1 tool-result invariant after every iteration (catches unmatched tool_use before API rejections). */
  invariantCheck?: boolean
  /** Fallback model to use when the primary model is overloaded (consecutive 529s). */
  fallbackModel?: string

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
  | 'interaction_proposed'
  | 'finalized'
  | 'message_stop'
  | 'withheld'
  | 'consultation_complete'
  | 'case_created'
  | 'sub_agent_start'
  | 'sub_agent_progress'
  | 'sub_agent_complete'
  | 'sub_agent_error'
  | 'core_agent_progress'
  | 'clarification'
  | 'policy_blocked'
  | 'retry_pending'
  | 'escalated'
  | 'error'

/** Option presented in a propose_interaction card. */
export interface InteractionOption {
  id: string
  label: string
  description?: string
  inputType?: 'none' | 'text' | 'number'
  inputPlaceholder?: string
}

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
  requireHumanReview?: boolean
  /** "stage" = predefined stage machine (default); "step" = engine-driven step executor */
  executionMode?: 'stage' | 'cc'
  /** Natural-language Standard Operating Procedure (only used when executionMode = "sop") */
  sop?: string
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
  /** Step mode only: ordered list of execution steps. Non-empty triggers step-driven execution. */
  steps?: ExecutionStep[]
  /** SOP prompt appendix (referenced in both stage and step modes). */
  sop?: string
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
// Step Mode — Engine-Driven Execution
// ============================================

export interface StepCriterion {
  type: 'tool_called' | 'fact_extracted' | 'output_matches' | 'llm_evaluation'
  value: string
}

export interface StepFailurePolicy {
  action: 'retry' | 'skip_step' | 'escalate_to_human' | 'abort_case'
  escalationQueue?: string
  escalationNote?: string
}

export interface ExecutionStep {
  id: string
  name: string
  goal: string
  requiredTools: string[]
  optionalTools?: string[]
  completionCriteria: StepCriterion[]
  onFailure: StepFailurePolicy
  maxRetries?: number
  timeoutMs?: number
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
  /** Sub-agent execution mode: "stage" (LLM-driven, default) or "sop" (SOP-driven). */
  executionMode?: 'stage' | 'cc'
  /** Fallback model when primary model is overloaded (consecutive 529s). */
  fallbackModel?: string
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
    chatMemory: ChatMemoryData
    stageGoal: string
  }
  /** Fork cache context — shared across same-type parallel sub-agents for prompt prefix reuse. */
  forkContext?: {
    chainId: string
    sharedSystemPrompt: string
    sharedSkills: string[]
    batchIndex: number
    batchSize: number
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

// ── Agent Context — unified execution context for main + sub agents ──

export interface AgentContext {
  agentId: string
  chainId: string
  depth: number
  parentAgentId?: string
  allowedTools: Set<string>
  isSubAgent: boolean
  maxIterations: number
  messageBus: MessageBus

  /** Sub-Agent: orchestrator-injected task checklist for ChecklistPolicy. */
  taskChecklist?: {
    goal: string
    requiredChecks: string[]
    outputFormat: string
    rules: string[]
  }
}

export interface MessageBus {
  send(to: string, msg: AgentMessage): void
  poll(agentId: string): AgentMessage[]
}

export interface AgentMessage {
  from: string
  type: 'update' | 'directive' | 'query' | 'result' | 'user_input'
  content: string
  timestamp: string
}

export interface ChainTracking {
  chainId: string
  depth: number
  parentAgentId?: string
}
