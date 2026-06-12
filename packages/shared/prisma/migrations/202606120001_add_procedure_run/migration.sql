ALTER TABLE "cases" ADD COLUMN "runtimeInputEpoch" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ProcedureRun" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "agentConfigId" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "procedureVersion" TEXT NOT NULL DEFAULT 'v2',
    "status" TEXT NOT NULL,
    "inputEpoch" INTEGER NOT NULL DEFAULT 0,
    "needsReconcile" BOOLEAN NOT NULL DEFAULT false,
    "currentStepId" TEXT,
    "outcome" TEXT,
    "state" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcedureRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProcedureRun_caseId_status_idx" ON "ProcedureRun"("caseId", "status");
CREATE INDEX "ProcedureRun_agentConfigId_procedureId_status_idx" ON "ProcedureRun"("agentConfigId", "procedureId", "status");
