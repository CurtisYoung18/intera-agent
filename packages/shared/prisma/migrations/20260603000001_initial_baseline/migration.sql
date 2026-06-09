-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "apiKey" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "agent_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default',
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "model" TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
    "temperature" REAL NOT NULL DEFAULT 0.5,
    "thinkingBudget" INTEGER NOT NULL DEFAULT 4096,
    "maxIterations" INTEGER NOT NULL DEFAULT 20,
    "systemPrompt" TEXT NOT NULL,
    "coreSystemPrompt" TEXT,
    "showThinking" BOOLEAN NOT NULL DEFAULT false,
    "maxOutputTokens" INTEGER,
    "resumePrompt" TEXT,
    "formResponseTemplate" TEXT,
    "humanSkills" TEXT,
    "consultationPrompt" TEXT,
    "debugMode" BOOLEAN NOT NULL DEFAULT false,
    "enableLlmSanitization" BOOLEAN NOT NULL DEFAULT false,
    "prefixContinuationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "prefixContinuationChatModel" TEXT,
    "prefixContinuationBaseUrl" TEXT,
    "prefixContinuationAssistantPrefix" TEXT,
    "prefixContinuationStop" TEXT,
    "prefixContinuationMinDraftChars" INTEGER NOT NULL DEFAULT 4,
    "memoryStrategy" TEXT NOT NULL,
    "policyHooks" TEXT NOT NULL,
    "knowledgeRetrieval" TEXT,
    "gptbotsApiKey" TEXT,
    "invariantCheck" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agent_configs_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "agent_configs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "case_types" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "org_id" TEXT NOT NULL DEFAULT 'default',
    "type" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT NOT NULL,
    "requiredFacts" TEXT NOT NULL,
    "stages" TEXT NOT NULL,
    "stageConfigs" TEXT,
    "orchestratorConfig" TEXT,
    "defaultGoal" TEXT NOT NULL,
    "escalateOn" TEXT NOT NULL,
    "autoCloseConditions" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "requireHumanReview" BOOLEAN NOT NULL DEFAULT false,
    "executionMode" TEXT NOT NULL DEFAULT 'stage',
    "sop" TEXT,
    "sopMaxAutoTurns" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "org_id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "inputSchema" TEXT NOT NULL,
    "outputSchema" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'mock',
    "endpoint" TEXT,
    "httpMethod" TEXT NOT NULL DEFAULT 'POST',
    "headers" TEXT,
    "timeoutMs" INTEGER NOT NULL DEFAULT 8000,
    "mockFixture" TEXT,
    "displayVerb" TEXT,
    "renderHints" TEXT,
    "guardPhase" TEXT NOT NULL DEFAULT 'post',
    "toolCategory" TEXT,
    "isConcurrencySafe" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "policies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "org_id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "hook" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "routings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "org_id" TEXT NOT NULL DEFAULT 'default',
    "queue" TEXT NOT NULL,
    "description" TEXT,
    "skillsAllowed" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "autoAssign" BOOLEAN NOT NULL DEFAULT true,
    "maxWaitingTime" INTEGER NOT NULL DEFAULT 300,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "org_id" TEXT NOT NULL DEFAULT 'default',
    "userId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "goal" TEXT,
    "blocker" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3)
);

-- CreateTable
CREATE TABLE "chat_memories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "confirmedFacts" TEXT NOT NULL DEFAULT '{}',
    "missingFacts" TEXT NOT NULL DEFAULT '[]',
    "skillsCalled" TEXT NOT NULL DEFAULT '[]',
    "skillResults" TEXT NOT NULL DEFAULT '{}',
    "keyEvents" TEXT NOT NULL DEFAULT '[]',
    "humanTaskStatus" TEXT NOT NULL DEFAULT 'none',
    "needsContinuation" BOOLEAN NOT NULL DEFAULT false,
    "continuationLock" TIMESTAMP(3),
    "summary" TEXT,
    "todos" TEXT,
    "agentTodos" TEXT,
    "dashboardVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chat_memories_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT 'default',
    "profile" TEXT NOT NULL DEFAULT '',
    "totalChats" INTEGER NOT NULL DEFAULT 0,
    "totalCases" INTEGER NOT NULL DEFAULT 0,
    "resolvedCases" INTEGER NOT NULL DEFAULT 0,
    "escalatedCases" INTEGER NOT NULL DEFAULT 0,
    "lastCaseType" TEXT,
    "firstSeenAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentBlocks" JSONB,
    "isStreaming" BOOLEAN NOT NULL DEFAULT false,
    "streamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "messages_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "action_traces" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "chatId" TEXT,
    "actionType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "payload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "action_traces_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "org_id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "groupIds" TEXT NOT NULL DEFAULT '[]',
    "dataIds" TEXT,
    "embeddingRate" REAL NOT NULL DEFAULT 0.9,
    "topK" INTEGER NOT NULL DEFAULT 5,
    "rerankVersion" TEXT,
    "docCorrelation" REAL,
    "caseTypeTag" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "external_conversations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "org_id" TEXT NOT NULL DEFAULT 'default',
    "platform" TEXT NOT NULL,
    "externalChatId" TEXT NOT NULL,
    "internalCaseId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "bridgeState" TEXT NOT NULL DEFAULT 'idle',
    "textBuffer" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "human_tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "question" TEXT NOT NULL,
    "fields" TEXT,
    "answers" TEXT,
    "verdict" TEXT,
    "expectedEta" TEXT,
    "notes" TEXT,
    "chatLog" TEXT,
    "customerMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    CONSTRAINT "human_tasks_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "livechat_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "org_id" TEXT,
    "botAccessToken" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "webhookSecret" TEXT,
    "region" TEXT NOT NULL DEFAULT 'dal',
    "authType" TEXT NOT NULL DEFAULT 'auto',
    "accountId" TEXT,
    "agentAccountId" TEXT,
    "showSkillStatus" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "transferGroupId" INTEGER,
    "transferMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "livechat_pending_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatId" TEXT NOT NULL,
    "org_id" TEXT NOT NULL DEFAULT 'default',
    "payload" JSONB NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "channel_health" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "org_id" TEXT NOT NULL DEFAULT 'default',
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'healthy',
    "lastChecked" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "metadata" JSONB
);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatId" TEXT NOT NULL,
    "org_id" TEXT NOT NULL DEFAULT 'default',
    "confirmedFacts" TEXT NOT NULL DEFAULT '{}',
    "summary" TEXT,
    "keyEvents" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "channel_bindings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "org_id" TEXT NOT NULL DEFAULT 'default',
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "credentials" TEXT NOT NULL DEFAULT '{}',
    "toolOverrides" TEXT,
    "defaults" TEXT,
    "channelSkillBinding" TEXT,
    "transferStrategy" TEXT,
    "transferTarget" TEXT,
    "consultationPrompt" TEXT,
    "humanSkills" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_hash_key" ON "api_keys"("hash");

-- CreateIndex
CREATE INDEX "api_keys_org_id_idx" ON "api_keys"("org_id");

-- CreateIndex
CREATE INDEX "agent_configs_org_id_idx" ON "agent_configs"("org_id");

-- CreateIndex
CREATE INDEX "agent_configs_org_id_name_isActive_idx" ON "agent_configs"("org_id", "name", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "agent_configs_org_id_name_version_key" ON "agent_configs"("org_id", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "case_types_org_id_type_key" ON "case_types"("org_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "skills_org_id_name_key" ON "skills"("org_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "policies_org_id_name_key" ON "policies"("org_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "routings_org_id_queue_key" ON "routings"("org_id", "queue");

-- CreateIndex
CREATE INDEX "cases_chatId_idx" ON "cases"("chatId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_memories_caseId_key" ON "chat_memories"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_userId_key" ON "user_profiles"("userId");

-- CreateIndex
CREATE INDEX "messages_caseId_idx" ON "messages"("caseId");

-- CreateIndex
CREATE INDEX "action_traces_caseId_idx" ON "action_traces"("caseId");

-- CreateIndex
CREATE INDEX "action_traces_chatId_idx" ON "action_traces"("chatId");

-- CreateIndex
CREATE INDEX "knowledge_sources_org_id_enabled_idx" ON "knowledge_sources"("org_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_sources_org_id_name_key" ON "knowledge_sources"("org_id", "name");

-- CreateIndex
CREATE INDEX "external_conversations_org_id_platform_status_idx" ON "external_conversations"("org_id", "platform", "status");

-- CreateIndex
CREATE UNIQUE INDEX "external_conversations_platform_externalChatId_key" ON "external_conversations"("platform", "externalChatId");

-- CreateIndex
CREATE INDEX "human_tasks_caseId_idx" ON "human_tasks"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "livechat_configs_org_id_key" ON "livechat_configs"("org_id");

-- CreateIndex
CREATE INDEX "webhook_events_platform_processedAt_idx" ON "webhook_events"("platform", "processedAt");

-- CreateIndex
CREATE INDEX "livechat_pending_events_nextRetryAt_attempt_idx" ON "livechat_pending_events"("nextRetryAt", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "channel_health_org_id_channel_key" ON "channel_health"("org_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "chat_sessions_chatId_key" ON "chat_sessions"("chatId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_bindings_org_id_channel_key" ON "channel_bindings"("org_id", "channel");

