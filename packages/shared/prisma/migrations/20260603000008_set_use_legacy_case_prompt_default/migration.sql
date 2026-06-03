-- Flip default of useLegacyCasePrompt from true to false.
-- New AgentConfig rows will now use base+append (coreSystemPrompt + caseAddendum) by default.
-- Existing rows are NOT changed by this alone — see the companion data-migration script.
ALTER TABLE "agent_configs" ALTER COLUMN "useLegacyCasePrompt" SET DEFAULT false;
