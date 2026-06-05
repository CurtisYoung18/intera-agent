# Intera Database Schema

Snapshot from Ubuntu self-hosted PostgreSQL, 2026-06-04.

## organizations

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| name | text | not null | |
| apiKey | text | | |
| password | text | | |
| createdAt | timestamp(3) | not null | CURRENT_TIMESTAMP |
| updatedAt | timestamp(3) | not null | |

**PK**: `id`

**Referenced by**: invitations, memberships

---

## users

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| email | text | not null | |
| name | text | | |
| google_sub | text | | |
| password_hash | text | | |
| createdAt | timestamp(3) | not null | CURRENT_TIMESTAMP |
| updatedAt | timestamp(3) | not null | |

**PK**: `id`
**Unique**: `email`, `google_sub`

**Referenced by**: audit_logs, invitations, memberships

---

## memberships

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| user_id | text | not null | |
| org_id | text | not null | |
| role | text | not null | |
| invited_at | timestamp(3) | not null | CURRENT_TIMESTAMP |
| accepted_at | timestamp(3) | | |

**PK**: `id`
**Unique**: `(user_id, org_id)`
**FK**: `user_id → users.id`, `org_id → organizations.id`

---

## agent_configs

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| org_id | text | not null | |
| name | text | not null | 'Default' |
| version | integer | not null | 1 |
| isActive | boolean | not null | true |
| parentId | text | | |
| model | text | not null | |
| temperature | double precision | not null | 0.5 |
| thinkingBudget | integer | not null | 4096 |
| maxIterations | integer | not null | 20 |
| maxOutputTokens | integer | | |
| systemPrompt | text | not null | |
| coreSystemPrompt | text | | |
| caseAddendum | text | | |
| useLegacyCasePrompt | boolean | not null | false |
| showThinking | boolean | not null | false |
| resumePrompt | text | | |
| debugMode | boolean | not null | false |
| memoryStrategy | text | not null | |
| policyHooks | text | not null | |
| capabilityBindings | text | | |
| gptbotsApiKey | text | | |
| invariantCheck | boolean | not null | false |
| release_note | text | | |
| published_at | timestamp(3) | | |
| published_by | text | | |
| createdAt | timestamp(3) | not null | CURRENT_TIMESTAMP |
| updatedAt | timestamp(3) | not null | |

**PK**: `id`
**Unique**: `(org_id, name, version)`
**FK**: `parentId → agent_configs.id` (self-referential, version history)

---

## policies

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| org_id | text | not null | 'default' |
| name | text | not null | |
| description | text | | |
| hook | text | not null | |
| rule | text | not null | |
| enabled | boolean | not null | true |
| createdAt | timestamp(3) | not null | CURRENT_TIMESTAMP |
| updatedAt | timestamp(3) | not null | |

**PK**: `id`
**Unique**: `(org_id, name)`

---

## skills

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| org_id | text | not null | 'default' |
| name | text | not null | |
| description | text | not null | |
| inputSchema | text | not null | |
| outputSchema | text | not null | |
| mode | text | not null | 'mock' |
| endpoint | text | | |
| httpMethod | text | not null | 'POST' |
| headers | text | | |
| timeoutMs | integer | not null | 8000 |
| mockFixture | text | | |
| displayVerb | text | | |
| renderHints | text | | |
| guardPhase | text | not null | 'post' |
| toolCategory | text | | |
| isConcurrencySafe | boolean | not null | true |
| enabled | boolean | not null | true |
| createdAt | timestamp(3) | not null | CURRENT_TIMESTAMP |
| updatedAt | timestamp(3) | not null | |

**PK**: `id`
**Unique**: `(org_id, name)`

---

## case_types

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| org_id | text | not null | 'default' |
| type | text | not null | |
| displayName | text | not null | |
| description | text | | |
| icon | text | not null | |
| requiredFacts | text | not null | |
| stages | text | not null | |
| stageConfigs | text | | |
| orchestratorConfig | text | | |
| defaultGoal | text | not null | |
| escalateOn | text | not null | |
| autoCloseConditions | text | | |
| enabled | boolean | not null | true |
| requireHumanReview | boolean | not null | false |
| executionMode | text | not null | 'stage' |
| sop | text | | |
| sopMaxAutoTurns | integer | not null | 10 |
| createdAt | timestamp(3) | not null | CURRENT_TIMESTAMP |
| updatedAt | timestamp(3) | not null | |

**PK**: `id`
**Unique**: `(org_id, type)`

---

## knowledge_sources

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| org_id | text | not null | 'default' |
| name | text | not null | |
| description | text | | |
| groupIds | text | not null | '[]' |
| dataIds | text | | |
| embeddingRate | double precision | not null | 0.9 |
| topK | integer | not null | 5 |
| rerankVersion | text | | |
| docCorrelation | double precision | | |
| caseTypeTag | text | | |
| enabled | boolean | not null | true |
| createdAt | timestamp(3) | not null | CURRENT_TIMESTAMP |
| updatedAt | timestamp(3) | not null | |

**PK**: `id`
**Unique**: `(org_id, name)`

---

## api_keys

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| org_id | text | not null | |
| agent_config_id | text | | |
| name | text | not null | |
| prefix | text | not null | |
| hash | text | not null | |
| last_used_at | timestamp(3) | | |
| revoked_at | timestamp(3) | | |
| createdAt | timestamp(3) | not null | CURRENT_TIMESTAMP |

**PK**: `id`
**Unique**: `hash`

---

## invitations

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| email | text | not null | |
| org_id | text | not null | |
| invited_by | text | not null | |
| role | text | not null | 'viewer' |
| token | text | not null | |
| state | text | not null | 'pending' |
| expires_at | timestamp(3) | not null | |
| createdAt | timestamp(3) | not null | CURRENT_TIMESTAMP |

**PK**: `id`
**Unique**: `(email, org_id)`, `token`
**FK**: `org_id → organizations.id`, `invited_by → users.id`

---

## audit_logs

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| actor_user_id | text | not null | |
| org_id | text | not null | |
| action | text | not null | |
| target | text | not null | |
| before | jsonb | | |
| after | jsonb | | |
| createdAt | timestamp(3) | not null | CURRENT_TIMESTAMP |

**PK**: `id`
**FK**: `actor_user_id → users.id`

---

## livechat_configs

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| org_id | text | | |
| botAccessToken | text | not null | |
| licenseId | text | not null | |
| webhookSecret | text | | |
| region | text | not null | 'dal' |
| authType | text | not null | 'auto' |
| accountId | text | | |
| agentAccountId | text | | |
| showSkillStatus | boolean | not null | true |
| enabled | boolean | not null | false |
| transferGroupId | integer | | |
| transferMessage | text | | |
| createdAt | timestamp(3) | not null | CURRENT_TIMESTAMP |
| updatedAt | timestamp(3) | not null | |

**PK**: `id`
**Unique**: `org_id`

---

## channel_bindings

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| org_id | text | not null | 'default' |
| channel | text | not null | |
| enabled | boolean | not null | false |
| credentials | text | not null | '{}' |
| toolOverrides | text | | |
| defaults | text | | |
| channelSkillBinding | text | | |
| transferStrategy | text | | |
| transferTarget | text | | |
| createdAt | timestamp(3) | not null | CURRENT_TIMESTAMP |
| updatedAt | timestamp(3) | not null | |

**PK**: `id`
**Unique**: `(org_id, channel)`

---

## chat_sessions

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| chatId | text | not null | |
| org_id | text | not null | 'default' |
| confirmedFacts | text | not null | '{}' |
| summary | text | | |
| keyEvents | text | not null | '[]' |
| createdAt | timestamp(3) | not null | CURRENT_TIMESTAMP |
| updatedAt | timestamp(3) | not null | |

**PK**: `id`
**Unique**: `chatId`

---

## external_conversations

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| org_id | text | not null | 'default' |
| platform | text | not null | |
| externalChatId | text | not null | |
| internalCaseId | text | | |
| status | text | not null | 'active' |
| bridgeState | text | not null | 'idle' |
| textBuffer | text | not null | '' |
| metadata | jsonb | | |
| createdAt | timestamp(3) | not null | CURRENT_TIMESTAMP |
| updatedAt | timestamp(3) | not null | |

**PK**: `id`
**Unique**: `(platform, externalChatId)`

---

## cases

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| org_id | text | not null | 'default' |
| userId | text | not null | |
| chatId | text | not null | |
| type | text | not null | |
| status | text | not null | 'created' |
| goal | text | | |
| blocker | text | | |
| createdAt | timestamp(3) | not null | CURRENT_TIMESTAMP |
| updatedAt | timestamp(3) | not null | |
| resolvedAt | timestamp(3) | | |

**PK**: `id`

**Referenced by**: action_traces, chat_memories, human_tasks, messages

---

## channel_health

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| org_id | text | not null | 'default' |
| channel | text | not null | |
| status | text | not null | 'healthy' |
| lastChecked | timestamp(3) | not null | CURRENT_TIMESTAMP |
| lastError | text | | |
| metadata | jsonb | | |

**PK**: `id`
**Unique**: `(org_id, channel)`

---

## livechat_pending_events

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| chatId | text | not null | |
| org_id | text | not null | 'default' |
| payload | jsonb | not null | |
| attempt | integer | not null | 0 |
| lastError | text | | |
| nextRetryAt | timestamp(3) | not null | CURRENT_TIMESTAMP |
| createdAt | timestamp(3) | not null | CURRENT_TIMESTAMP |

**PK**: `id`

---

## user_profiles

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| userId | text | not null | |
| orgId | text | not null | 'default' |
| profile | text | not null | '' |
| sections | text | not null | '{}' |
| totalChats | integer | not null | 0 |
| totalCases | integer | not null | 0 |
| resolvedCases | integer | not null | 0 |
| escalatedCases | integer | not null | 0 |
| lastCaseType | text | | |
| firstSeenAt | timestamp(3) | | |
| lastSeenAt | timestamp(3) | | |
| createdAt | timestamp(3) | not null | CURRENT_TIMESTAMP |
| updatedAt | timestamp(3) | not null | |

**PK**: `id`
**Unique**: `userId`

---

## action_traces

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| caseId | text | not null | |
| chatId | text | | |
| actionType | text | not null | |
| title | text | not null | |
| detail | text | | |
| payload | text | | |
| createdAt | timestamp(3) | not null | CURRENT_TIMESTAMP |

**PK**: `id`
**FK**: `caseId → cases.id`

---

## chat_memories

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| caseId | text | not null | |
| confirmedFacts | text | not null | '{}' |
| missingFacts | text | not null | '[]' |
| skillsCalled | text | not null | '[]' |
| skillResults | text | not null | '{}' |
| keyEvents | text | not null | '[]' |
| humanTaskStatus | text | not null | 'none' |
| needsContinuation | boolean | not null | false |
| continuationLock | timestamp(3) | | |
| summary | text | | |
| todos | text | | |
| agentTodos | text | | |
| dashboardVersion | integer | not null | 0 |
| createdAt | timestamp(3) | not null | CURRENT_TIMESTAMP |
| updatedAt | timestamp(3) | not null | |

**PK**: `id`
**Unique**: `caseId`
**FK**: `caseId → cases.id`

---

## human_tasks

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| caseId | text | not null | |
| queue | text | not null | |
| status | text | not null | 'pending' |
| question | text | not null | |
| fields | text | | |
| answers | text | | |
| verdict | text | | |
| expectedEta | text | | |
| notes | text | | |
| chatLog | text | | |
| customerMessage | text | | |
| createdAt | timestamp(3) | not null | CURRENT_TIMESTAMP |
| resolvedAt | timestamp(3) | | |
| notifiedAt | timestamp(3) | | |

**PK**: `id`
**FK**: `caseId → cases.id`

---

## messages

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| caseId | text | not null | |
| role | text | not null | |
| content | text | not null | |
| contentBlocks | jsonb | | |
| isStreaming | boolean | not null | false |
| streamId | text | | |
| createdAt | timestamp(3) | not null | CURRENT_TIMESTAMP |

**PK**: `id`
**FK**: `caseId → cases.id`

---

## routings

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| org_id | text | not null | 'default' |
| queue | text | not null | |
| description | text | | |
| skillsAllowed | text | not null | |
| priority | integer | not null | 0 |
| autoAssign | boolean | not null | true |
| maxWaitingTime | integer | not null | 300 |
| createdAt | timestamp(3) | not null | CURRENT_TIMESTAMP |
| updatedAt | timestamp(3) | not null | |

**PK**: `id`
**Unique**: `(org_id, queue)`

---

## webhook_events

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | text | not null | |
| platform | text | not null | |
| processedAt | timestamp(3) | not null | CURRENT_TIMESTAMP |

**PK**: `id`

---

## _prisma_migrations

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | varchar(36) | not null | |
| checksum | varchar(64) | not null | |
| finished_at | timestamptz | | |
| migration_name | varchar(255) | not null | |
| logs | text | | |
| rolled_back_at | timestamptz | | |
| started_at | timestamptz | not null | now() |
| applied_steps_count | integer | not null | 0 |

**PK**: `id`

---

## Index of Tables

| # | Table | Purpose |
|---|-------|---------|
| 1 | organizations | Tenant orgs |
| 2 | users | Console user accounts (email, Google SSO) |
| 3 | memberships | User ↔ Org join with role |
| 4 | agent_configs | AI agent configs per org (versioned) |
| 5 | policies | Guardrail policies per org |
| 6 | skills | Tools/skills available to agents |
| 7 | case_types | Case type definitions with stage configs |
| 8 | knowledge_sources | RAG knowledge bases |
| 9 | api_keys | API keys for programmatic access |
| 10 | invitations | Org membership invitations |
| 11 | audit_logs | Audit trail |
| 12 | livechat_configs | LiveChat channel config |
| 13 | channel_bindings | Per-channel routing/tools config |
| 14 | chat_sessions | Active chat state |
| 15 | external_conversations | External chat platform bridge |
| 16 | cases | Support case tracking |
| 17 | channel_health | Channel health status |
| 18 | livechat_pending_events | LiveChat retry queue |
| 19 | user_profiles | Per-user profile/analytics |
| 20 | action_traces | Agent action audit log |
| 21 | chat_memories | Case-level memory/working state |
| 22 | human_tasks | Human-in-the-loop tasks |
| 23 | messages | Chat messages per case |
| 24 | routings | Human task routing queues |
| 25 | webhook_events | External webhook dedup log |
| 26 | _prisma_migrations | Prisma migration history |
