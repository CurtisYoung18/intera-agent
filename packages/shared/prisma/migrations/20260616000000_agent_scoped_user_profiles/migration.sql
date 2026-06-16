-- Scope UserProfile rows to a concrete AgentConfig.
-- Existing legacy rows are retained under an empty agent_config_id sentinel so
-- they cannot be read as if they belonged to a selected agent.

ALTER TABLE "user_profiles"
  ADD COLUMN IF NOT EXISTS "agent_config_id" TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS "user_profiles_orgId_userId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "user_profiles_orgId_agent_config_id_userId_key"
  ON "user_profiles"("orgId", "agent_config_id", "userId");

CREATE INDEX IF NOT EXISTS "user_profiles_orgId_agent_config_id_idx"
  ON "user_profiles"("orgId", "agent_config_id");
