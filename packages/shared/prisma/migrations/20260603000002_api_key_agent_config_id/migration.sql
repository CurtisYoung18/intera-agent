-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN "agent_config_id" TEXT;

-- CreateIndex
CREATE INDEX "api_keys_org_id_agent_config_id_idx" ON "api_keys"("org_id", "agent_config_id");
