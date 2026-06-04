-- Drop vestigial User.role — the canonical role lives on Membership.
ALTER TABLE "users" DROP COLUMN IF EXISTS "role";
