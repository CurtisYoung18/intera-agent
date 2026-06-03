-- Add caseAddendum + useLegacyCasePrompt for base+append model
ALTER TABLE "agent_configs" ADD COLUMN "caseAddendum" TEXT;
ALTER TABLE "agent_configs" ADD COLUMN "useLegacyCasePrompt" BOOLEAN NOT NULL DEFAULT true;
