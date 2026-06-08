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
  enableChatMemory: boolean
  chatMemoryMaxTokens: number
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
  tokensPerTool: number
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
  coreSystemPrompt: string
  caseAddendum: string
  useLegacyCasePrompt: boolean
  showThinking: boolean
  memoryStrategy: MemoryStrategy
  resumePrompt: string
  debugMode: boolean
  invariantCheck: boolean
}

export interface ModelInfo {
  id: string
  name: string
  provider: string
  providerLabel: string
}

export const DEFAULT_MEMORY: MemoryStrategy = {
  l1MaxMessages: 20,
  l2SummaryMaxTokens: 2000,
  l4MaxHistoricalCases: 5,
  keyEventExtractionPrompt: 'Extract key events from the conversation',
  maxRecentTraces: 20,
  caseRetentionDays: 90,
  autocompactThresholdTokens: 40000,
  warningThresholdTokens: 50000,
  errorThresholdTokens: 60000,
  blockingThresholdTokens: 15000,
  compactModel: 'deepseek-v4-flash',
  enableAutocompact: true,
  enableMicrocompact: false,
  microcompactMinAgeMs: 300000,
  enableContextCollapse: true,
  enableSnip: true,
  enableChatMemory: true,
  chatMemoryMaxTokens: 4000,
  compactMaxMessages: 40,
  compactTemperature: 0.3,
  compactMaxTokensCap: 4096,
  compactMinSummaryLength: 100,
  compactionKeepMin: 20,
  compactionKeepRatio: 0.65,
  compactableTools: [],
  factExtractionPrompt: '',
  keyEventMaxChars: 100,
  tokensPerKeyEvent: 20,
  tokensPerFact: 15,
  tokensPerTool: 30,
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
