-- R2 physical legacy cleanup.
--
-- This migration performs the last safe backfill from the old long-term model
-- before deleting its live schema surface:
--   * Policy rows -> Hook rows
--   * CaseType.guardrails[] -> HookBinding(scopeType='caseType')
--   * ChatMemory skillsCalled/skillResults -> toolsCalled/toolResults
--   * historical skill_* / policy_hit ActionTrace actionType values -> current values
--
-- Old CaseType stage/sub-agent/SOP fields and dead ChatMemory sub-agent fields
-- are archived into private tables that are not modeled by Prisma and are not
-- read by current runtime APIs.
-- Retired built-in Tool rows are archived before deletion so historical
-- configuration is recoverable without exposing those tools to current routing.

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

-- Re-run Policy -> Hook backfill for any rows created after the F1 migration.
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

-- Re-run CaseType.guardrails[] -> HookBinding backfill for any late updates.
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

-- Private historical archive for old CaseType fields that have no current
-- runtime equivalent. This prevents data loss without keeping live columns.
CREATE TABLE IF NOT EXISTS "intera_legacy_case_type_archive" (
  "case_type_id" TEXT PRIMARY KEY,
  "agent_config_id" TEXT NOT NULL,
  "case_type" TEXT NOT NULL,
  "legacy" JSONB NOT NULL,
  "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "intera_legacy_case_type_archive" (
  "case_type_id",
  "agent_config_id",
  "case_type",
  "legacy"
)
SELECT
  ct."id",
  ct."agent_config_id",
  ct."type",
  jsonb_strip_nulls(jsonb_build_object(
    'stages', intera_legacy_jsonb(ct."stages"),
    'stageConfigs', intera_legacy_jsonb(ct."stageConfigs"),
    'orchestratorConfig', intera_legacy_jsonb(ct."orchestratorConfig"),
    'guardrails', intera_legacy_jsonb(ct."guardrails"),
    'requireHumanReview', ct."requireHumanReview",
    'executionMode', ct."executionMode",
    'sop', ct."sop",
    'sopMaxAutoTurns', ct."sopMaxAutoTurns"
  ))
FROM "case_types" ct
WHERE
  ct."stages" IS NOT NULL
  OR ct."stageConfigs" IS NOT NULL
  OR ct."orchestratorConfig" IS NOT NULL
  OR ct."guardrails" IS NOT NULL
  OR ct."requireHumanReview" = true
  OR ct."executionMode" IS NOT NULL
  OR ct."sop" IS NOT NULL
  OR ct."sopMaxAutoTurns" IS NOT NULL
ON CONFLICT ("case_type_id") DO UPDATE SET
  "legacy" = EXCLUDED."legacy",
  "archived_at" = CURRENT_TIMESTAMP;

-- Private historical archive for dead sub-agent continuation fields.
CREATE TABLE IF NOT EXISTS "intera_legacy_chat_memory_archive" (
  "case_id" TEXT PRIMARY KEY,
  "legacy" JSONB NOT NULL,
  "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "intera_legacy_chat_memory_archive" (
  "case_id",
  "legacy"
)
SELECT
  cm."caseId",
  jsonb_strip_nulls(jsonb_build_object(
    'needsContinuation', cm."needsContinuation",
    'continuationLock', to_jsonb(cm."continuationLock"),
    'agentTodos', intera_legacy_jsonb(cm."agentTodos"),
    'dashboardVersion', cm."dashboardVersion"
  ))
FROM "chat_memories" cm
WHERE
  cm."needsContinuation" = true
  OR cm."continuationLock" IS NOT NULL
  OR cm."agentTodos" IS NOT NULL
  OR cm."dashboardVersion" <> 0
ON CONFLICT ("case_id") DO UPDATE SET
  "legacy" = EXCLUDED."legacy",
  "archived_at" = CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "intera_legacy_tool_archive" (
  "tool_id" TEXT PRIMARY KEY,
  "agent_config_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "legacy" JSONB NOT NULL,
  "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "intera_legacy_tool_archive" (
  "tool_id",
  "agent_config_id",
  "name",
  "legacy"
)
SELECT
  t."id",
  t."agent_config_id",
  t."name",
  to_jsonb(t)
FROM "tools" t
WHERE t."name" IN ('dispatch_subagent', 'finalize_case_agent')
ON CONFLICT ("tool_id") DO UPDATE SET
  "legacy" = EXCLUDED."legacy",
  "archived_at" = CURRENT_TIMESTAMP;

DELETE FROM "tools"
WHERE "name" IN ('dispatch_subagent', 'finalize_case_agent');

UPDATE "action_traces"
SET "actionType" = CASE "actionType"
  WHEN 'skill_call' THEN 'tool_call'
  WHEN 'skill_called' THEN 'tool_call'
  WHEN 'skill_result' THEN 'tool_result'
  WHEN 'policy_hit' THEN 'hook_hit'
  ELSE "actionType"
END
WHERE "actionType" IN ('skill_call', 'skill_called', 'skill_result', 'policy_hit');

ALTER TABLE "chat_memories" RENAME COLUMN "skillsCalled" TO "toolsCalled";
ALTER TABLE "chat_memories" RENAME COLUMN "skillResults" TO "toolResults";
ALTER TABLE "chat_memories" DROP COLUMN "needsContinuation";
ALTER TABLE "chat_memories" DROP COLUMN "continuationLock";
ALTER TABLE "chat_memories" DROP COLUMN "agentTodos";
ALTER TABLE "chat_memories" DROP COLUMN "dashboardVersion";

ALTER TABLE "case_types" DROP COLUMN "stages";
ALTER TABLE "case_types" DROP COLUMN "stageConfigs";
ALTER TABLE "case_types" DROP COLUMN "orchestratorConfig";
ALTER TABLE "case_types" DROP COLUMN "requireHumanReview";
ALTER TABLE "case_types" DROP COLUMN "executionMode";
ALTER TABLE "case_types" DROP COLUMN "sop";
ALTER TABLE "case_types" DROP COLUMN "sopMaxAutoTurns";
ALTER TABLE "case_types" DROP COLUMN "guardrails";

DROP TABLE IF EXISTS "policies";

DROP FUNCTION IF EXISTS intera_legacy_jsonb(TEXT);
DROP FUNCTION IF EXISTS intera_legacy_jsonb_array_text(TEXT);
