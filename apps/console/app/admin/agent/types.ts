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
  enableContextCollapse: boolean
  enableSnip: boolean
  compactMaxMessages: number
  compactTemperature: number
  compactMaxTokensCap: number
  compactMinSummaryLength: number
  compactionKeepMin: number
  compactionKeepRatio: number
  compactableTools: string[]
  txnIdPattern: string
  amountPattern: string
  notReceivedKeywords: string[]
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
  autocompactThresholdTokens: 13000,
  warningThresholdTokens: 20000,
  errorThresholdTokens: 20000,
  blockingThresholdTokens: 3000,
  compactModel: 'MiniMax-M2.5-highspeed',
  enableAutocompact: true,
  enableMicrocompact: true,
  enableContextCollapse: true,
  enableSnip: true,
  compactMaxMessages: 40,
  compactTemperature: 0.3,
  compactMaxTokensCap: 4096,
  compactMinSummaryLength: 20,
  compactionKeepMin: 4,
  compactionKeepRatio: 0.4,
  compactableTools: ['query_order_status', 'query_payment_channel_status', 'search_delay_notice', 'read_case_history', 'kb_hybrid_retrieve', 'ocr_receipt'],
  txnIdPattern: 'TX[Uu]?\\d+|[A-Z]{2,6}\\d{8,}',
  amountPattern: '(\\d+\\.?\\d*)\\s*(元|USD|EUR|JPY|₩|¥|\\$)',
  notReceivedKeywords: ['未到账', '没到账', '没收到', 'not received', 'not credited', 'missing', '未入金'],
  keyEventMaxChars: 100,
  tokensPerKeyEvent: 20,
  tokensPerFact: 15,
  tokensPerSkill: 30,
  cjkCharPerToken: 1.2,
  latinCharPerToken: 3,
  minTokenEstimate: 100,
  toolResultTokenRatio: 3,
  compactPrompt: '',
  toolResultTemplate: 'Tool {name} result:\n{output}',
  contextWindow: 200000,
  outputTokensReserved: 20000,
  maxKeyEventsAfterCompact: 5,
  compactCircuitBreakerMaxFailures: 3,
  sessionMemoryMaxAgeMs: 1800000,
}
