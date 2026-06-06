-- Drop dead tables
DROP TABLE IF EXISTS "channel_health";

-- Clear old org-scoped data (discarded per migration Decision A)
DELETE FROM "policies";
DELETE FROM "skills";
DELETE FROM "case_types";
DELETE FROM "knowledge_sources";
DELETE FROM "channel_bindings";

-- Drop deprecated columns from agent_configs
ALTER TABLE "agent_configs" DROP COLUMN IF EXISTS "policyHooks";
ALTER TABLE "agent_configs" DROP COLUMN IF EXISTS "capabilityBindings";

-- Drop old unique constraints
ALTER TABLE "policies" DROP CONSTRAINT IF EXISTS "policies_org_id_name_key";
ALTER TABLE "skills" DROP CONSTRAINT IF EXISTS "skills_org_id_name_key";
ALTER TABLE "case_types" DROP CONSTRAINT IF EXISTS "case_types_org_id_type_key";
ALTER TABLE "knowledge_sources" DROP CONSTRAINT IF EXISTS "knowledge_sources_org_id_name_key";
ALTER TABLE "channel_bindings" DROP CONSTRAINT IF EXISTS "channel_bindings_org_id_agent_name_channel_key";
ALTER TABLE "channel_bindings" DROP CONSTRAINT IF EXISTS "channel_bindings_orgId_channel_agentName_null_key";

-- Drop old orgId columns
ALTER TABLE "policies" DROP COLUMN IF EXISTS "org_id";
ALTER TABLE "skills" DROP COLUMN IF EXISTS "org_id";
ALTER TABLE "case_types" DROP COLUMN IF EXISTS "org_id";
ALTER TABLE "knowledge_sources" DROP COLUMN IF EXISTS "org_id";
ALTER TABLE "channel_bindings" DROP COLUMN IF EXISTS "org_id";
ALTER TABLE "channel_bindings" DROP COLUMN IF EXISTS "agent_name";

-- Add agentConfigId columns (NOT NULL since old data is cleared)
ALTER TABLE "policies" ADD COLUMN IF NOT EXISTS "agent_config_id" TEXT NOT NULL;
ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "agent_config_id" TEXT NOT NULL;
ALTER TABLE "case_types" ADD COLUMN IF NOT EXISTS "agent_config_id" TEXT NOT NULL;
ALTER TABLE "knowledge_sources" ADD COLUMN IF NOT EXISTS "agent_config_id" TEXT NOT NULL;
ALTER TABLE "channel_bindings" ADD COLUMN IF NOT EXISTS "agent_config_id" TEXT NOT NULL;

-- Add new unique constraints
ALTER TABLE "policies" ADD CONSTRAINT "policies_agent_config_id_name_key" UNIQUE ("agent_config_id", "name");
ALTER TABLE "skills" ADD CONSTRAINT "skills_agent_config_id_name_key" UNIQUE ("agent_config_id", "name");
ALTER TABLE "case_types" ADD CONSTRAINT "case_types_agent_config_id_type_key" UNIQUE ("agent_config_id", "type");
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_agent_config_id_name_key" UNIQUE ("agent_config_id", "name");
ALTER TABLE "channel_bindings" ADD CONSTRAINT "channel_bindings_agent_config_id_channel_key" UNIQUE ("agent_config_id", "channel");

-- Create indexes
CREATE INDEX IF NOT EXISTS "idx_policies_agent_config_id" ON "policies" ("agent_config_id");
CREATE INDEX IF NOT EXISTS "idx_tools_agent_config_id" ON "skills" ("agent_config_id");
CREATE INDEX IF NOT EXISTS "idx_case_types_agent_config_id" ON "case_types" ("agent_config_id");
CREATE INDEX IF NOT EXISTS "idx_knowledge_sources_agent_config_id_enabled" ON "knowledge_sources" ("agent_config_id", "enabled");
CREATE INDEX IF NOT EXISTS "idx_channel_bindings_agent_config_id" ON "channel_bindings" ("agent_config_id");

-- Rename skills table to tools
ALTER TABLE "skills" RENAME TO "tools";
