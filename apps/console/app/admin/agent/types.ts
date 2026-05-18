export interface MemoryStrategy {
  l1MaxMessages: number
  l2SummaryMaxTokens: number
  l4MaxHistoricalCases: number
  keyEventExtractionPrompt: string
  maxRecentTraces: number
  caseRetentionDays: number
  autocompactThresholdTokens: number
  warningThresholdTokens: number
  errorThresholdTokens: number
  blockingThresholdTokens: number
  compactModel: string
  enableAutocompact: boolean
  enableMicrocompact: boolean
  microcompactMinAgeMs: number
  enableContextCollapse: boolean
  enableSnip: boolean
  compactMaxMessages: number
  compactTemperature: number
  compactMaxTokensCap: number
  compactMinSummaryLength: number
  compactionKeepMin: number
  compactionKeepRatio: number
  compactableTools: string[]
  factExtractionPrompt: string
  keyEventMaxChars: number
  tokensPerKeyEvent: number
  tokensPerFact: number
  tokensPerSkill: number
  cjkCharPerToken: number
  latinCharPerToken: number
  minTokenEstimate: number
  toolResultTokenRatio: number
  compactPrompt: string
  toolResultTemplate: string
  contextWindow: number
  outputTokensReserved: number
  maxKeyEventsAfterCompact: number
  compactCircuitBreakerMaxFailures: number
  sessionMemoryMaxAgeMs: number
}

export interface AgentConfigData {
  model: string
  temperature: number
  thinkingBudget: number
  maxIterations: number
  maxOutputTokens: number
  systemPrompt: string
  toolParallelism: boolean
  isConcurrencySafe: boolean
  showThinking: boolean
  memoryStrategy: MemoryStrategy
  policyHooks: string
  resumePrompt: string
  formResponseTemplate: string
  evaluationModel: string
  intentModel: string
  prefixContinuationEnabled: boolean
  prefixContinuationChatModel: string
  prefixContinuationBaseUrl: string
  prefixContinuationAssistantPrefix: string
  /** One stop sequence per line in UI; stored as JSON string[] server-side */
  prefixContinuationStopText: string
  prefixContinuationMinDraftChars: number
}

export interface ModelInfo {
  id: string
  name: string
  provider: string
  providerLabel: string
}

export const DEFAULT_MEMORY: MemoryStrategy = {
  l1MaxMessages: 12,
  l2SummaryMaxTokens: 2000,
  l4MaxHistoricalCases: 5,
  keyEventExtractionPrompt: 'Extract key events from the conversation',
  maxRecentTraces: 20,
  caseRetentionDays: 90,
  autocompactThresholdTokens: 40000,
  warningThresholdTokens: 50000,
  errorThresholdTokens: 60000,
  blockingThresholdTokens: 15000,
  compactModel: 'MiniMax-M2.5-highspeed',
  enableAutocompact: true,
  enableMicrocompact: true,
  microcompactMinAgeMs: 60000,
  enableContextCollapse: true,
  enableSnip: true,
  compactMaxMessages: 40,
  compactTemperature: 0.3,
  compactMaxTokensCap: 4096,
  compactMinSummaryLength: 100,
  compactionKeepMin: 6,
  compactionKeepRatio: 0.65,
  compactableTools: ['query_order_status', 'query_payment_channel_status', 'search_delay_notice', 'read_case_history', 'kb_hybrid_retrieve', 'ocr_receipt', 'query_account_status'],
  factExtractionPrompt: '',
  keyEventMaxChars: 100,
  tokensPerKeyEvent: 20,
  tokensPerFact: 15,
  tokensPerSkill: 30,
  cjkCharPerToken: 1.5,
  latinCharPerToken: 4,
  minTokenEstimate: 100,
  toolResultTokenRatio: 4,
  compactPrompt: '',
  toolResultTemplate: 'Tool {name} result:\n{output}',
  contextWindow: 200000,
  outputTokensReserved: 20000,
  maxKeyEventsAfterCompact: 5,
  compactCircuitBreakerMaxFailures: 3,
  sessionMemoryMaxAgeMs: 1800000,
}
