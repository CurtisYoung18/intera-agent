-- B3: Version release notes — add release_note, published_at, published_by to agent_configs

ALTER TABLE "agent_configs" ADD COLUMN "release_note" TEXT;
ALTER TABLE "agent_configs" ADD COLUMN "published_at" TIMESTAMP(3);
ALTER TABLE "agent_configs" ADD COLUMN "published_by" TEXT;
