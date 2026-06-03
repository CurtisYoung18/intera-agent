-- Add capabilityBindings JSON column to AgentConfig (unified version-bound capability manifest)
ALTER TABLE "agent_configs" ADD COLUMN "capabilityBindings" TEXT;
