-- G11 Phase 1: Add guardrailConfig column to Policy table
-- guardrailConfig stores the new GuardrailHook JSON (superset of PolicyRule).
-- Existing rule column is preserved for backward compat; backfill maps built-ins.

ALTER TABLE "policies" ADD COLUMN "guardrailConfig" TEXT;
