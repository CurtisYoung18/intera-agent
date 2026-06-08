-- Foundation Reset F1: create Hook / HookBinding and backfill from legacy
-- Policy rows plus CaseType.guardrails activation lists.
--
-- Legacy policies/guardrails remain as runtime migration inputs until the
-- HookEngine and Hooks API lanes remove old reads. New configuration should use
-- hooks + hook_bindings.

-- CreateTable
CREATE TABLE "hooks" (
    "id" TEXT NOT NULL,
    "agent_config_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "description" TEXT,
    "checkpoint" TEXT NOT NULL,
    "handlerKind" TEXT NOT NULL,
    "handler" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hook_bindings" (
    "id" TEXT NOT NULL,
    "agent_config_id" TEXT NOT NULL,
    "hook_id" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "case_type_id" TEXT,
    "procedure_step_id" TEXT,
    "tool_id" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hook_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hooks_agent_config_id_name_key" ON "hooks"("agent_config_id", "name");
CREATE INDEX "hooks_agent_config_id_checkpoint_idx" ON "hooks"("agent_config_id", "checkpoint");
CREATE UNIQUE INDEX "hook_bindings_agent_config_id_hook_id_scopeKey_key" ON "hook_bindings"("agent_config_id", "hook_id", "scopeKey");
CREATE INDEX "hook_bindings_agent_config_id_scopeType_idx" ON "hook_bindings"("agent_config_id", "scopeType");
CREATE INDEX "hook_bindings_agent_config_id_scopeKey_idx" ON "hook_bindings"("agent_config_id", "scopeKey");

-- AddForeignKey
ALTER TABLE "hooks" ADD CONSTRAINT "hooks_agent_config_id_fkey" FOREIGN KEY ("agent_config_id") REFERENCES "agent_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hook_bindings" ADD CONSTRAINT "hook_bindings_hook_id_fkey" FOREIGN KEY ("hook_id") REFERENCES "hooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION intera_legacy_jsonb(input TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  IF input IS NULL OR btrim(input) = '' THEN
    RETURN NULL;
  END IF;
  RETURN input::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION intera_legacy_jsonb_array_text(input TEXT)
RETURNS TABLE(value TEXT)
LANGUAGE plpgsql
AS $$
BEGIN
  IF input IS NULL OR btrim(input) = '' THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT jsonb_array_elements_text(input::jsonb);
EXCEPTION WHEN others THEN
  RETURN;
END;
$$;

-- Backfill Hook rows from Policy rows. The old payload is preserved inside
-- handler.legacy so export/import can include historical evidence without
-- adding old top-level package fields.
INSERT INTO "hooks" (
  "id",
  "agent_config_id",
  "name",
  "displayName",
  "description",
  "checkpoint",
  "handlerKind",
  "handler",
  "enabled",
  "severity",
  "createdAt",
  "updatedAt"
)
SELECT
  p."id",
  p."agent_config_id",
  p."name",
  NULL,
  p."description",
  CASE COALESCE(intera_legacy_jsonb(p."guardrailConfig")->>'when', p."hook")
    WHEN 'preTool' THEN 'PreToolUse'
    WHEN 'postTool' THEN 'PostToolUse'
    WHEN 'preFinalize' THEN 'Stop'
    WHEN 'PreToolUse' THEN 'PreToolUse'
    WHEN 'PostToolUse' THEN 'PostToolUse'
    WHEN 'Stop' THEN 'Stop'
    ELSE 'Stop'
  END,
  'declarative',
  jsonb_build_object(
    'kind', 'declarative',
    'check', jsonb_build_object(
      'kind', 'legacy_policy',
      'checkpoint', CASE COALESCE(intera_legacy_jsonb(p."guardrailConfig")->>'when', p."hook")
        WHEN 'preTool' THEN 'PreToolUse'
        WHEN 'postTool' THEN 'PostToolUse'
        WHEN 'preFinalize' THEN 'Stop'
        WHEN 'PreToolUse' THEN 'PreToolUse'
        WHEN 'PostToolUse' THEN 'PostToolUse'
        WHEN 'Stop' THEN 'Stop'
        ELSE 'Stop'
      END,
      'match', COALESCE(intera_legacy_jsonb(p."guardrailConfig")->'match', jsonb_build_object('tools', '[]'::jsonb))
    ),
    'effect', jsonb_build_object(
      'decision', CASE COALESCE(intera_legacy_jsonb(p."guardrailConfig")#>>'{onViolation,action}', 'block')
        WHEN 'warn' THEN 'warn'
        WHEN 'invoke_tool' THEN 'escalate'
        WHEN 'block' THEN 'block'
        ELSE 'block'
      END,
      'guidance', COALESCE(
        intera_legacy_jsonb(p."guardrailConfig")#>>'{onViolation,guidance}',
        intera_legacy_jsonb(p."guardrailConfig")->>'guidance',
        p."description"
      )
    ),
    'legacy', jsonb_build_object(
      'source', 'Policy',
      'hook', p."hook",
      'rule', intera_legacy_jsonb(p."rule"),
      'guardrailConfig', intera_legacy_jsonb(p."guardrailConfig")
    )
  )::text,
  p."enabled",
  'medium',
  p."createdAt",
  p."updatedAt"
FROM "policies" p
ON CONFLICT ("agent_config_id", "name") DO NOTHING;

-- Backfill the platform safety floor as an agent binding when the matching row
-- exists. CaseType-specific legacy guardrail activation becomes caseType scope
-- below.
INSERT INTO "hook_bindings" (
  "id",
  "agent_config_id",
  "hook_id",
  "scopeType",
  "scopeKey",
  "enabled",
  "createdAt",
  "updatedAt"
)
SELECT
  'hookbinding_' || substr(md5(h."agent_config_id" || ':' || h."id" || ':agent'), 1, 24),
  h."agent_config_id",
  h."id",
  'agent',
  'agent',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "hooks" h
WHERE h."name" = 'no_high_risk_account_change'
ON CONFLICT ("agent_config_id", "hook_id", "scopeKey") DO NOTHING;

-- Backfill CaseType.guardrails[] into HookBinding(scopeType='caseType').
INSERT INTO "hook_bindings" (
  "id",
  "agent_config_id",
  "hook_id",
  "scopeType",
  "scopeKey",
  "case_type_id",
  "enabled",
  "createdAt",
  "updatedAt"
)
SELECT
  'hookbinding_' || substr(md5(ct."agent_config_id" || ':' || h."id" || ':caseType:' || ct."id"), 1, 24),
  ct."agent_config_id",
  h."id",
  'caseType',
  'caseType:' || ct."id",
  ct."id",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "case_types" ct
JOIN LATERAL intera_legacy_jsonb_array_text(ct."guardrails") AS g(name) ON true
JOIN "hooks" h
  ON h."agent_config_id" = ct."agent_config_id"
 AND h."name" = g.name
ON CONFLICT ("agent_config_id", "hook_id", "scopeKey") DO NOTHING;

DROP FUNCTION IF EXISTS intera_legacy_jsonb(TEXT);
DROP FUNCTION IF EXISTS intera_legacy_jsonb_array_text(TEXT);
