-- Phase 5 (2026-06-08): Drop legacy columns no longer referenced by runtime.
-- systemPrompt, caseAddendum, useLegacyCasePrompt → legacy prompt swap path removed
-- debugMode, invariantCheck → moved to env-only flags (INTERA_DEBUG_LOGS, INTERA_INVARIANT_CHECK)
-- showThinking column stays (mapped to extendedThinking via @map)
ALTER TABLE "agent_configs" DROP COLUMN IF EXISTS "caseAddendum";
ALTER TABLE "agent_configs" DROP COLUMN IF EXISTS "debugMode";
ALTER TABLE "agent_configs" DROP COLUMN IF EXISTS "invariantCheck";
ALTER TABLE "agent_configs" DROP COLUMN IF EXISTS "systemPrompt";
ALTER TABLE "agent_configs" DROP COLUMN IF EXISTS "useLegacyCasePrompt";
