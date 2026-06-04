-- Add sections JSON column to UserProfile for structured profile data
ALTER TABLE "user_profiles" ADD COLUMN "sections" TEXT NOT NULL DEFAULT '{}';
