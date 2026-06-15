ALTER TABLE "chat_memories" RENAME COLUMN "confirmedFacts" TO "contextMap";

ALTER TABLE "chat_sessions" RENAME COLUMN "confirmedFacts" TO "contextMap";
