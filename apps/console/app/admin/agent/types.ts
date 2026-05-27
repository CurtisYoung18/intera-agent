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

export interface KnowledgeRetrievalConfig {
  /** 'disabled' | 'external-api' | 'intera-native' */
  mode: 'disabled' | 'external-api' | 'intera-native'
  // External RAG API mode
  externalEndpoint: string
  externalApiKeyEnvVar: string
  // Intera-native: embedding
  embeddingProvider: 'openai' | 'cohere' | 'self-hosted'
  embeddingModel: string
  embeddingBaseUrl: string
  // Retrieval parameters (both modes)
  topK: number
  minRelevanceScore: number
  // Native-only advanced features
  enableReranker: boolean
  rerankProvider: 'cohere' | 'self-hosted'
  enableContextualRetrieval: boolean
  contextualModel: string
}

export const DEFAULT_KNOWLEDGE_RETRIEVAL: KnowledgeRetrievalConfig = {
  mode: 'disabled',
  externalEndpoint: '',
  externalApiKeyEnvVar: '',
  embeddingProvider: 'openai',
  embeddingModel: 'text-embedding-3-small',
  embeddingBaseUrl: '',
  topK: 5,
  minRelevanceScore: 0.4,
  enableReranker: false,
  rerankProvider: 'cohere',
  enableContextualRetrieval: false,
  contextualModel: 'claude-haiku-4-5',
}

export interface AgentConfigData {
  model: string
  fallbackModel: string
  temperature: number
  thinkingBudget: number
  maxIterations: number
  maxOutputTokens: number
  systemPrompt: string
  showThinking: boolean
  memoryStrategy: MemoryStrategy
  policyHooks: string
  resumePrompt: string
  formResponseTemplate: string
  humanSkills: string
  consultationPrompt: string
  debugMode: boolean
  enableLlmSanitization: boolean
  invariantCheck: boolean
  evaluationModel: string
  prefixContinuationEnabled: boolean
  prefixContinuationChatModel: string
  prefixContinuationBaseUrl: string
  prefixContinuationAssistantPrefix: string
  /** One stop sequence per line in UI; stored as JSON string[] server-side */
  prefixContinuationStopText: string
  prefixContinuationMinDraftChars: number
  knowledgeRetrieval: KnowledgeRetrievalConfig
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
  compactableTools: ['query_order_status', 'query_payment_channel_status', 'search_delay_notice', 'read_case_history', 'kb_hybrid_retrieve', 'ocr_receipt'],
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
