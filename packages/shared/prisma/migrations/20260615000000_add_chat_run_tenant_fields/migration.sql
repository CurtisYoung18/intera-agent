-- Add first-class tenant/chat/run ownership to runtime evidence tables.
-- `caseId` remains as a legacy relational join during the transition, but new
-- queries should be able to scope by org_id + chatId and, where known, run_id.

-- ProcedureRun gets direct org/chat ownership so run IDs can be resolved without
-- exposing or relying on Case IDs at product/API boundaries.
ALTER TABLE "ProcedureRun" ADD COLUMN "org_id" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "ProcedureRun" ADD COLUMN "chatId" TEXT NOT NULL DEFAULT '';

UPDATE "ProcedureRun" AS pr
SET
  "org_id" = c."org_id",
  "chatId" = c."chatId"
FROM "cases" AS c
WHERE pr."caseId" = c."id";

-- ChatMemory
ALTER TABLE "chat_memories" ADD COLUMN "org_id" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "chat_memories" ADD COLUMN "chatId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "chat_memories" ADD COLUMN "run_id" TEXT;

UPDATE "chat_memories" AS cm
SET
  "org_id" = c."org_id",
  "chatId" = c."chatId",
  "run_id" = (
    SELECT pr."id"
    FROM "ProcedureRun" AS pr
    WHERE pr."caseId" = c."id"
    ORDER BY pr."updatedAt" DESC
    LIMIT 1
  )
FROM "cases" AS c
WHERE cm."caseId" = c."id";

-- Messages
ALTER TABLE "messages" ADD COLUMN "org_id" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "messages" ADD COLUMN "chatId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "messages" ADD COLUMN "run_id" TEXT;

UPDATE "messages" AS m
SET
  "org_id" = c."org_id",
  "chatId" = c."chatId",
  "run_id" = (
    SELECT pr."id"
    FROM "ProcedureRun" AS pr
    WHERE pr."caseId" = c."id"
    ORDER BY pr."updatedAt" DESC
    LIMIT 1
  )
FROM "cases" AS c
WHERE m."caseId" = c."id";

-- ActionTrace already had chatId, but it was optional and not tenant-scoped.
ALTER TABLE "action_traces" ADD COLUMN "org_id" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "action_traces" ADD COLUMN "run_id" TEXT;

UPDATE "action_traces" AS at
SET
  "org_id" = c."org_id",
  "chatId" = COALESCE(at."chatId", c."chatId"),
  "run_id" = (
    SELECT pr."id"
    FROM "ProcedureRun" AS pr
    WHERE pr."caseId" = c."id"
    ORDER BY pr."updatedAt" DESC
    LIMIT 1
  )
FROM "cases" AS c
WHERE at."caseId" = c."id";

-- HumanTask
ALTER TABLE "human_tasks" ADD COLUMN "org_id" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "human_tasks" ADD COLUMN "chatId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "human_tasks" ADD COLUMN "run_id" TEXT;

UPDATE "human_tasks" AS ht
SET
  "org_id" = c."org_id",
  "chatId" = c."chatId",
  "run_id" = (
    SELECT pr."id"
    FROM "ProcedureRun" AS pr
    WHERE pr."caseId" = c."id"
    ORDER BY pr."updatedAt" DESC
    LIMIT 1
  )
FROM "cases" AS c
WHERE ht."caseId" = c."id";

-- Scope previously global uniqueness to the active org.
DROP INDEX IF EXISTS "user_profiles_userId_key";
CREATE UNIQUE INDEX "user_profiles_orgId_userId_key" ON "user_profiles"("orgId", "userId");
CREATE INDEX "user_profiles_userId_idx" ON "user_profiles"("userId");

DROP INDEX IF EXISTS "chat_sessions_chatId_key";
CREATE UNIQUE INDEX "chat_sessions_org_id_chatId_key" ON "chat_sessions"("org_id", "chatId");

-- Query indexes for the new ownership model.
CREATE INDEX "ProcedureRun_org_id_chatId_status_idx" ON "ProcedureRun"("org_id", "chatId", "status");

CREATE INDEX "chat_memories_org_id_chatId_idx" ON "chat_memories"("org_id", "chatId");
CREATE INDEX "chat_memories_org_id_run_id_idx" ON "chat_memories"("org_id", "run_id");

CREATE INDEX "messages_org_id_chatId_idx" ON "messages"("org_id", "chatId");
CREATE INDEX "messages_org_id_run_id_idx" ON "messages"("org_id", "run_id");

CREATE INDEX "action_traces_org_id_chatId_idx" ON "action_traces"("org_id", "chatId");
CREATE INDEX "action_traces_org_id_run_id_idx" ON "action_traces"("org_id", "run_id");

CREATE INDEX "human_tasks_org_id_chatId_idx" ON "human_tasks"("org_id", "chatId");
CREATE INDEX "human_tasks_org_id_run_id_idx" ON "human_tasks"("org_id", "run_id");
