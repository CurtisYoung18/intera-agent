-- Gate A: durable Pilot operator cockpit persistence.
-- These records are Console/operator state only. They are intentionally
-- separate from customer ChatMemory/UserProfile and from runtime ProcedureRun
-- authority.

CREATE TABLE "pilot_sessions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "agent_config_id" TEXT,
    "agent_family_key" TEXT,
    "binding_scope" TEXT NOT NULL DEFAULT 'draft_agent',
    "created_by_user_id" TEXT NOT NULL,
    "active_editor_user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "title" TEXT NOT NULL DEFAULT 'Pilot session',
    "current_mode" TEXT NOT NULL DEFAULT 'critique_existing_agent',
    "summary" JSONB,
    "pinned_state" JSONB,
    "current_build_brief_id" TEXT,
    "current_todo_plan_id" TEXT,
    "current_active_todo_item_id" TEXT,
    "latest_proposal_id" TEXT,
    "latest_receipt_run_id" TEXT,
    "latest_handoff_id" TEXT,
    "memory_degraded" BOOLEAN NOT NULL DEFAULT false,
    "compacted_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pilot_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pilot_messages" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'message',
    "content" TEXT NOT NULL,
    "structured_payload" JSONB,
    "created_by_user_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilot_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pilot_proposals" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "todo_item_id" TEXT,
    "parent_proposal_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'drafted',
    "primary_surface" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "intent_summary" TEXT,
    "batch_rationale" TEXT,
    "blast_radius" TEXT,
    "validation_plan" JSONB,
    "proposal" JSONB NOT NULL,
    "diff_groups" JSONB,
    "patch_count" INTEGER NOT NULL DEFAULT 0,
    "base_agent_config_id" TEXT NOT NULL,
    "base_draft_fingerprint" TEXT NOT NULL,
    "accepted_by_user_id" TEXT,
    "accepted_at" TIMESTAMP(3),
    "applied_by_user_id" TEXT,
    "applied_at" TIMESTAMP(3),
    "applied_draft_agent_config_id" TEXT,
    "created_by_user_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pilot_proposals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pilot_todo_plans" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "title" TEXT,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pilot_todo_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pilot_todo_items" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "visible_reason" TEXT,
    "latest_proposal_id" TEXT,
    "latest_receipt_run_id" TEXT,
    "latest_handoff_id" TEXT,
    "target_scenario_name" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pilot_todo_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pilot_handoffs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "draft_agent_config_id" TEXT NOT NULL,
    "draft_fingerprint" TEXT NOT NULL,
    "handoff_summary" TEXT NOT NULL,
    "readiness_verdict" TEXT NOT NULL DEFAULT 'not_ready',
    "blockers" JSONB,
    "risks" JSONB,
    "referenced_proposal_ids" JSONB,
    "referenced_receipt_ids" JSONB,
    "covered_todo_item_ids" JSONB,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pilot_handoffs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_build_briefs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "agent_family_key" TEXT NOT NULL,
    "session_id" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "business_goal" TEXT,
    "target_channels" JSONB NOT NULL,
    "supported_use_cases" JSONB NOT NULL,
    "out_of_scope_use_cases" JSONB NOT NULL,
    "escalation_policy" TEXT,
    "required_tools_and_integrations" JSONB NOT NULL,
    "tone_and_response_constraints" JSONB NOT NULL,
    "validation_expectations" JSONB NOT NULL,
    "open_questions" JSONB NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by_user_id" TEXT,
    "superseded_at" TIMESTAMP(3),
    "superseded_by_id" TEXT,
    "created_by_user_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_build_briefs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "template_recommendations" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "brief_id" TEXT NOT NULL,
    "candidate_templates" JSONB NOT NULL,
    "recommended_template_id" TEXT,
    "fit_summary" TEXT NOT NULL,
    "mismatch_summary" TEXT,
    "why_not_scratch" TEXT,
    "why_scratch" TEXT,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "superseded_at" TIMESTAMP(3),
    "superseded_by_id" TEXT,
    "created_by_user_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_recommendations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "template_tailoring_plans" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "brief_id" TEXT NOT NULL,
    "recommendation_id" TEXT,
    "selected_template_id" TEXT NOT NULL,
    "fit_areas" JSONB NOT NULL,
    "mismatch_areas" JSONB NOT NULL,
    "required_tailoring_groups" JSONB NOT NULL,
    "recommended_tailoring_groups" JSONB NOT NULL,
    "first_validation_targets" JSONB NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "superseded_at" TIMESTAMP(3),
    "superseded_by_id" TEXT,
    "created_by_user_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_tailoring_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "scratch_build_plans" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "brief_id" TEXT NOT NULL,
    "scratch_scope" TEXT NOT NULL DEFAULT 'default',
    "proposed_foundation_surfaces" JSONB NOT NULL,
    "required_build_groups" JSONB NOT NULL,
    "recommended_build_groups" JSONB NOT NULL,
    "initial_tooling_plan" JSONB NOT NULL,
    "initial_validation_targets" JSONB NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "superseded_at" TIMESTAMP(3),
    "superseded_by_id" TEXT,
    "created_by_user_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scratch_build_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pilot_inspection_traces" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "action_class" TEXT NOT NULL,
    "target_object_ref" JSONB,
    "steps" JSONB NOT NULL,
    "evidence_sufficient" BOOLEAN NOT NULL DEFAULT false,
    "stop_reason" TEXT,
    "created_by_user_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilot_inspection_traces_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pilot_sessions_org_id_agent_config_id_is_current_idx" ON "pilot_sessions"("org_id", "agent_config_id", "is_current");
CREATE INDEX "pilot_sessions_org_id_agent_family_key_binding_scope_is_current_idx" ON "pilot_sessions"("org_id", "agent_family_key", "binding_scope", "is_current");
CREATE INDEX "pilot_sessions_created_by_user_id_idx" ON "pilot_sessions"("created_by_user_id");
CREATE UNIQUE INDEX "pilot_sessions_current_agent_unique" ON "pilot_sessions"("org_id", "agent_config_id") WHERE "is_current" = true AND "agent_config_id" IS NOT NULL;
CREATE UNIQUE INDEX "pilot_sessions_current_family_unique" ON "pilot_sessions"("org_id", "agent_family_key", "binding_scope") WHERE "is_current" = true AND "agent_family_key" IS NOT NULL;

CREATE INDEX "pilot_messages_org_id_session_id_createdAt_idx" ON "pilot_messages"("org_id", "session_id", "createdAt");
CREATE INDEX "pilot_proposals_org_id_session_id_createdAt_idx" ON "pilot_proposals"("org_id", "session_id", "createdAt");
CREATE INDEX "pilot_proposals_org_id_status_idx" ON "pilot_proposals"("org_id", "status");
CREATE INDEX "pilot_proposals_base_agent_config_id_idx" ON "pilot_proposals"("base_agent_config_id");
CREATE INDEX "pilot_todo_plans_org_id_session_id_is_current_idx" ON "pilot_todo_plans"("org_id", "session_id", "is_current");
CREATE UNIQUE INDEX "pilot_todo_plans_current_session_unique" ON "pilot_todo_plans"("org_id", "session_id") WHERE "is_current" = true;
CREATE INDEX "pilot_todo_items_org_id_session_id_status_idx" ON "pilot_todo_items"("org_id", "session_id", "status");
CREATE INDEX "pilot_todo_items_org_id_plan_id_status_idx" ON "pilot_todo_items"("org_id", "plan_id", "status");
CREATE INDEX "pilot_handoffs_org_id_session_id_is_current_idx" ON "pilot_handoffs"("org_id", "session_id", "is_current");
CREATE UNIQUE INDEX "pilot_handoffs_current_session_unique" ON "pilot_handoffs"("org_id", "session_id") WHERE "is_current" = true;
CREATE INDEX "pilot_handoffs_draft_agent_config_id_idx" ON "pilot_handoffs"("draft_agent_config_id");
CREATE INDEX "agent_build_briefs_org_id_agent_family_key_is_current_idx" ON "agent_build_briefs"("org_id", "agent_family_key", "is_current");
CREATE INDEX "agent_build_briefs_org_id_status_idx" ON "agent_build_briefs"("org_id", "status");
CREATE UNIQUE INDEX "agent_build_briefs_current_family_unique" ON "agent_build_briefs"("org_id", "agent_family_key") WHERE "is_current" = true;
CREATE INDEX "template_recommendations_org_id_brief_id_is_current_idx" ON "template_recommendations"("org_id", "brief_id", "is_current");
CREATE UNIQUE INDEX "template_recommendations_current_brief_unique" ON "template_recommendations"("org_id", "brief_id") WHERE "is_current" = true;
CREATE INDEX "template_tailoring_plans_org_id_brief_id_selected_template_id_is_current_idx" ON "template_tailoring_plans"("org_id", "brief_id", "selected_template_id", "is_current");
CREATE UNIQUE INDEX "template_tailoring_plans_current_template_path_unique" ON "template_tailoring_plans"("org_id", "brief_id", "selected_template_id") WHERE "is_current" = true;
CREATE INDEX "scratch_build_plans_org_id_brief_id_scratch_scope_is_current_idx" ON "scratch_build_plans"("org_id", "brief_id", "scratch_scope", "is_current");
CREATE UNIQUE INDEX "scratch_build_plans_current_scratch_path_unique" ON "scratch_build_plans"("org_id", "brief_id", "scratch_scope") WHERE "is_current" = true;
CREATE INDEX "pilot_inspection_traces_org_id_session_id_createdAt_idx" ON "pilot_inspection_traces"("org_id", "session_id", "createdAt");

ALTER TABLE "pilot_messages" ADD CONSTRAINT "pilot_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "pilot_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pilot_proposals" ADD CONSTRAINT "pilot_proposals_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "pilot_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pilot_proposals" ADD CONSTRAINT "pilot_proposals_todo_item_id_fkey" FOREIGN KEY ("todo_item_id") REFERENCES "pilot_todo_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pilot_todo_plans" ADD CONSTRAINT "pilot_todo_plans_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "pilot_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pilot_todo_items" ADD CONSTRAINT "pilot_todo_items_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "pilot_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pilot_todo_items" ADD CONSTRAINT "pilot_todo_items_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "pilot_todo_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pilot_handoffs" ADD CONSTRAINT "pilot_handoffs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "pilot_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_build_briefs" ADD CONSTRAINT "agent_build_briefs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "pilot_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "template_recommendations" ADD CONSTRAINT "template_recommendations_brief_id_fkey" FOREIGN KEY ("brief_id") REFERENCES "agent_build_briefs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "template_tailoring_plans" ADD CONSTRAINT "template_tailoring_plans_brief_id_fkey" FOREIGN KEY ("brief_id") REFERENCES "agent_build_briefs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "template_tailoring_plans" ADD CONSTRAINT "template_tailoring_plans_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "template_recommendations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scratch_build_plans" ADD CONSTRAINT "scratch_build_plans_brief_id_fkey" FOREIGN KEY ("brief_id") REFERENCES "agent_build_briefs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pilot_inspection_traces" ADD CONSTRAINT "pilot_inspection_traces_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "pilot_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
