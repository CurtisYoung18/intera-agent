# Shipped Work Receipts

**Last updated:** 2026-06-08
**Purpose:** keep historical delivery evidence searchable without letting old plans become current instructions.

This directory is an archive of past work. Many files were originally written as implementation plans and later moved here after the work shipped. They may still contain unchecked boxes, old lane instructions, and legacy terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`.

Do not dispatch new work from this directory. Current work starts at:

1. [`../README.md`](../README.md)
2. [`../handoffs/MASTER_BUILD_HANDOFF.md`](../handoffs/MASTER_BUILD_HANDOFF.md)
3. [`../to-do/2026-06-08-foundation-reset-domain-model.md`](../to-do/2026-06-08-foundation-reset-domain-model.md)
4. [`../spec/Intera_Harness_架构梳理.md`](../spec/Intera_Harness_架构梳理.md)

## Reading Rules

- Treat these files as evidence, not source-of-truth architecture.
- Trust explicit shipped/verified sections more than old checklist prose.
- If a file says "ready for dispatch" or contains `- [ ]` tasks, it is historical unless re-linked from `MASTER_BUILD_HANDOFF.md`.
- Old names are left in place when changing them would distort what shipped at that time.
- Every non-README file now has a historical note at the top to reduce accidental redispatch.

## High-Signal Current Receipts

| File | Why it matters now |
|---|---|
| [`2026-06-08-foundation-safe-local-db.md`](./2026-06-08-foundation-safe-local-db.md) | Safe local Postgres foundation. Important for all reset verification. |
| [`2026-06-05-playground-trace-single-contract.md`](./2026-06-05-playground-trace-single-contract.md) | TraceWriter and playground trace contract history. |
| [`2026-06-05-playground-experience-hardening.md`](./2026-06-05-playground-experience-hardening.md) | Playground UX/runtime hardening context. |
| [`2026-06-05-renderhints-normalization-chat-cleanup.md`](./2026-06-05-renderhints-normalization-chat-cleanup.md) | Tool/renderHint channel-key cleanup history. |
| [`2026-06-05-livechat-per-agent-consolidation.md`](./2026-06-05-livechat-per-agent-consolidation.md) | Per-agent LiveChat/channel binding direction. |
| [`2026-06-04-console-backend-migration.md`](./2026-06-04-console-backend-migration.md) | Admin route migration and backend seam history. |
| [`2026-06-04-enterprise-saas-readiness.md`](./2026-06-04-enterprise-saas-readiness.md) | Earlier enterprise-readiness review; useful but terminology is pre-reset. |
| [`2026-06-08-model-page-long-term-refactor.md`](./2026-06-08-model-page-long-term-refactor.md) | Historical plan only. Useful for prompt/model-page background; not current dispatch. |

## Index By Area

### Foundation, Deploy, Migration

| File | Notes |
|---|---|
| [`06-01-deployment.md`](./06-01-deployment.md) | Ubuntu deployment, auth, Phase B history. |
| [`06-01-chat-to-console-migration.md`](./06-01-chat-to-console-migration.md) | Chat app to Console migration history. |
| [`2026-06-02-01-remove-agent-config-id.md`](./2026-06-02-01-remove-agent-config-id.md) | ApiKey schema cleanup receipt. |
| [`2026-06-02-02-fix-prisma-seed.md`](./2026-06-02-02-fix-prisma-seed.md) | Prisma seed/codegen fix. |
| [`2026-06-02-03-fix-docked-preview-swc.md`](./2026-06-02-03-fix-docked-preview-swc.md) | SWC build fix. |
| [`2026-06-02-post-phase-b-cleanup.md`](./2026-06-02-post-phase-b-cleanup.md) | Post-migration cleanup notes. |
| [`2026-06-08-foundation-safe-local-db.md`](./2026-06-08-foundation-safe-local-db.md) | Current high-signal foundation receipt. |

### Runtime, Memory, Prompt

| File | Notes |
|---|---|
| [`05-26-agent-architecture-refactor-s1-s6.md`](./05-26-agent-architecture-refactor-s1-s6.md) | Early runtime refactor history. |
| [`05-29-chat-memory-redesign.md`](./05-29-chat-memory-redesign.md) | Chat memory redesign and review history. |
| [`2026-06-03-memory-three-layer-redesign.md`](./2026-06-03-memory-three-layer-redesign.md) | Historical implementation plan; superseded by later receipts. |
| [`2026-06-04-todo-41-memory-three-layer-redesign.md`](./2026-06-04-todo-41-memory-three-layer-redesign.md) | Completed TODO-41 receipt. |
| [`2026-06-03-U1-case-prompt-base-append-plan.md`](./2026-06-03-U1-case-prompt-base-append-plan.md) | Historical prompt plan. |
| [`2026-06-03-U1-phase-2-case-prompt-cleanup.md`](./2026-06-03-U1-phase-2-case-prompt-cleanup.md) | Prompt cleanup plan/receipt. |
| [`2026-06-03-ux-batch-2-prompt-playground.md`](./2026-06-03-ux-batch-2-prompt-playground.md) | Prompt + Playground UX batch history. |
| [`2026-06-05-loop-decomposition.md`](./2026-06-05-loop-decomposition.md) | Runtime decomposition background. |
| [`2026-06-05-tool-result-format-fix.md`](./2026-06-05-tool-result-format-fix.md) | Tool-result message-format plan/receipt. |

### Playground And Trace

| File | Notes |
|---|---|
| [`2026-06-03-playground-bugs.md`](./2026-06-03-playground-bugs.md) | Playground bug fixes. |
| [`2026-06-03-trace-cleanup.md`](./2026-06-03-trace-cleanup.md) | Trace cleanup review/plan. |
| [`2026-06-04-todo-42-trace-cleanup.md`](./2026-06-04-todo-42-trace-cleanup.md) | Completed TODO-42 receipt. |
| [`2026-06-05-playground-multi-turn-persistence-KICKOFF.md`](./2026-06-05-playground-multi-turn-persistence-KICKOFF.md) | Kickoff note only. |
| [`2026-06-05-playground-multi-turn-persistence.md`](./2026-06-05-playground-multi-turn-persistence.md) | Historical plan; check current code before relying on details. |
| [`2026-06-05-playground-right-panel-redesign.md`](./2026-06-05-playground-right-panel-redesign.md) | Unified timeline redesign. |
| [`2026-06-05-playground-experience-hardening.md`](./2026-06-05-playground-experience-hardening.md) | High-signal playground hardening. |
| [`2026-06-05-playground-trace-single-contract.md`](./2026-06-05-playground-trace-single-contract.md) | High-signal trace contract receipt. |
| [`2026-06-05-playground-trace-ux-hardening.md`](./2026-06-05-playground-trace-ux-hardening.md) | Trace UX hardening plan/receipt. |

### Console, Admin, UX

| File | Notes |
|---|---|
| [`05-26-05-27-console-redesign.md`](./05-26-05-27-console-redesign.md) | Early console redesign history. |
| [`2026-06-03-friday-delivery-plan.md`](./2026-06-03-friday-delivery-plan.md) | Historical Friday coordination plan. |
| [`2026-06-03-lane-A-agent-playground.md`](./2026-06-03-lane-A-agent-playground.md) | Historical lane plan. |
| [`2026-06-03-lane-B-nav-integrations.md`](./2026-06-03-lane-B-nav-integrations.md) | Historical lane plan. |
| [`2026-06-03-lane-1-capability-bindings-runtime.md`](./2026-06-03-lane-1-capability-bindings-runtime.md) | Historical runtime binding plan. |
| [`2026-06-03-lane-2-crud-consolidation.md`](./2026-06-03-lane-2-crud-consolidation.md) | Historical CRUD consolidation plan. |
| [`2026-06-03-lane-3-binding-ui-blueprint-pages.md`](./2026-06-03-lane-3-binding-ui-blueprint-pages.md) | Historical UI binding plan. |
| [`2026-06-03-version-bound-config-blueprint-redesign.md`](./2026-06-03-version-bound-config-blueprint-redesign.md) | Historical version/binding redesign. |
| [`2026-06-03-v1.2-blockers.md`](./2026-06-03-v1.2-blockers.md) | v1.2 blocker review. |
| [`2026-06-03-logo-lockup.md`](./2026-06-03-logo-lockup.md) | Logo implementation handoff. |
| [`2026-06-04-agent-build-ux-punchlist.md`](./2026-06-04-agent-build-ux-punchlist.md) | Agent-building UX punch list. |
| [`2026-06-04-arch-review-console-backend.md`](./2026-06-04-arch-review-console-backend.md) | Console/backend architecture review. |
| [`2026-06-04-console-backend-migration.md`](./2026-06-04-console-backend-migration.md) | Backend migration high-signal history. |
| [`2026-06-04-google-invite-flow-hardening.md`](./2026-06-04-google-invite-flow-hardening.md) | Invite flow hardening plan/receipt. |
| [`2026-06-04-org-settings-integrations-consolidation.md`](./2026-06-04-org-settings-integrations-consolidation.md) | Org settings/integrations consolidation. |
| [`2026-06-08-model-page-long-term-refactor.md`](./2026-06-08-model-page-long-term-refactor.md) | Historical model-page plan; do not dispatch without revalidation. |

### Knowledge, LiveChat, Channels

| File | Notes |
|---|---|
| [`05-25-05-28-livechat-integration.md`](./05-25-05-28-livechat-integration.md) | LiveChat integration history. |
| [`05-28-kb-retrieval-tuning.md`](./05-28-kb-retrieval-tuning.md) | GPTBots retrieval tuning. |
| [`2026-06-05-kb-search-topk-model-control.md`](./2026-06-05-kb-search-topk-model-control.md) | KB topK model-control plan/receipt. |
| [`2026-06-05-knowledge-page-redesign.md`](./2026-06-05-knowledge-page-redesign.md) | Knowledge page redesign. |
| [`2026-06-05-knowledge-add-source-gptbots-fix.md`](./2026-06-05-knowledge-add-source-gptbots-fix.md) | GPTBots add-source fix. |
| [`2026-06-05-livechat-per-agent-consolidation.md`](./2026-06-05-livechat-per-agent-consolidation.md) | High-signal per-agent LiveChat consolidation. |
| [`2026-06-05-renderhints-normalization-chat-cleanup.md`](./2026-06-05-renderhints-normalization-chat-cleanup.md) | High-signal renderHint channel cleanup. |

### Data And Naming

| File | Notes |
|---|---|
| [`05-29-05-30-customer-vendor-org-rename.md`](./05-29-05-30-customer-vendor-org-rename.md) | Customer/Vendor/Org naming history. |
| [`2026-06-04-sub-agent-max-iterations-config.md`](./2026-06-04-sub-agent-max-iterations-config.md) | Historical sub-agent config change; target reset retires this path for customer turns. |

## Adding Future Receipts

When moving an active plan here, rewrite the top of the file so it reads like a receipt:

- shipped status
- commit(s)
- changed files
- verification commands/results
- production/browser evidence if relevant
- residual risks

Keep the old plan body below if useful, but make the top section unambiguous.
