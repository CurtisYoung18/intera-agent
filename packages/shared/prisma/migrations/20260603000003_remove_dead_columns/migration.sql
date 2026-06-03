-- Drop dead columns: composer-assist prefix fields (feature removed) + knowledgeRetrieval (never implemented)
ALTER TABLE "agent_configs" DROP COLUMN "prefixContinuationEnabled";
ALTER TABLE "agent_configs" DROP COLUMN "prefixContinuationChatModel";
ALTER TABLE "agent_configs" DROP COLUMN "prefixContinuationBaseUrl";
ALTER TABLE "agent_configs" DROP COLUMN "prefixContinuationAssistantPrefix";
ALTER TABLE "agent_configs" DROP COLUMN "prefixContinuationStop";
ALTER TABLE "agent_configs" DROP COLUMN "prefixContinuationMinDraftChars";
ALTER TABLE "agent_configs" DROP COLUMN "knowledgeRetrieval";
