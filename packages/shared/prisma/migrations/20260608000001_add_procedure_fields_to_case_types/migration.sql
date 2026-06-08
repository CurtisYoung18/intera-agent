-- Procedure refactor — Phase 1 (additive, no behavior change).
-- Adds the Procedure / case-type-scoped guardrail fields to case_types.
-- Old stage fields (stages, stageConfigs, orchestratorConfig, sop, executionMode,
-- sopMaxAutoTurns, requireHumanReview) stay until Phase 5.

-- AlterTable
ALTER TABLE "case_types" ADD COLUMN     "procedure" TEXT,
ADD COLUMN     "guardrails" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "maxAutoTurns" INTEGER NOT NULL DEFAULT 10;
