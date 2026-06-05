-- Add source field to Case model to distinguish live vs playground cases
ALTER TABLE "cases" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'live';
