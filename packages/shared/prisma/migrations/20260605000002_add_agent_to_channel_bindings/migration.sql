-- Wave 1 EXPAND phase: add agent dimension to channel_bindings.
-- Does NOT drop livechat_configs or any columns. Everything additive.

-- 1. Add new columns
ALTER TABLE "channel_bindings" ADD COLUMN IF NOT EXISTS "agent_name" TEXT;
ALTER TABLE "channel_bindings" ADD COLUMN IF NOT EXISTS "bot_access_token" TEXT;
ALTER TABLE "channel_bindings" ADD COLUMN IF NOT EXISTS "license_id" TEXT;

-- 2. Replace unique constraint: (org_id, channel) → (org_id, agent_name, channel)
ALTER TABLE "channel_bindings" DROP CONSTRAINT IF EXISTS "channel_bindings_org_id_channel_key";
ALTER TABLE "channel_bindings" ADD CONSTRAINT "channel_bindings_org_id_agent_name_channel_key"
  UNIQUE ("org_id", "agent_name", "channel");

-- 3. Partial unique index: at most one NULL-agent (org-default) binding per (org, channel)
CREATE UNIQUE INDEX IF NOT EXISTS "channel_bindings_orgId_channel_agentName_null_key"
  ON "channel_bindings" ("org_id", "channel")
  WHERE "agent_name" IS NULL;

-- 4. Backfill: each livechat_configs row → one channel_bindings row (agent_name = NULL)
INSERT INTO "channel_bindings" (
  "id", "org_id", "agent_name", "channel", "enabled", "credentials",
  "bot_access_token", "license_id", "createdAt", "updatedAt"
)
SELECT
  concat('cb_', lc."org_id"),
  lc."org_id",
  NULL,
  'livechat',
  lc."enabled",
  jsonb_build_object(
    'botAccessToken', lc."botAccessToken",
    'licenseId', lc."licenseId",
    'webhookSecret', lc."webhookSecret",
    'region', lc."region",
    'authType', lc."authType",
    'accountId', lc."accountId",
    'agentAccountId', lc."agentAccountId"
  )::text,
  lc."botAccessToken",
  lc."licenseId",
  lc."createdAt",
  lc."updatedAt"
FROM "livechat_configs" lc
ON CONFLICT ("org_id", "agent_name", "channel") DO NOTHING;
