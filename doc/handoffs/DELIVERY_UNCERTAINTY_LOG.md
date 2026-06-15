# Delivery Uncertainty And Defaults Log

**Last updated:** 2026-06-12
**Audience:** founder, architect, delivery lead, coding-team leads, QA lead
**Purpose:** record uncertain decisions, temporary defaults, blockers, and owner-review items discovered during the commercial delivery push.

---

## Rules

- Record uncertainty as soon as it affects implementation, QA, production acceptance, UX, copy, runtime behavior, data setup, LiveChat readiness, Procedure design, or release confidence.
- Choose a conservative default when work can continue safely, then record that default here for owner review.
- Do not hide uncertainty inside chat, screenshots, or receipts only. This file is the review queue.
- Do not use this file to defer P0/P1 blockers silently. If the issue affects first customer delivery, it must still be fixed or explicitly owner-deferred.
- Do not paste secrets, customer credentials, webhook secrets, raw API keys, or private LiveChat config values. Reference source files and redact identifiers.

---

## Log Template

Use this format for each new item:

```md
### YYYY-MM-DD - SHORT_TITLE

- Area:
- Status: open | default-applied | fixed | owner-deferred | closed
- Severity: P0 | P1 | P2 | P3
- Uncertainty:
- Default action taken:
- Why this default:
- Evidence:
- Production URL / screenshot / receipt:
- Owner decision needed:
- Follow-up owner:
```

---

## Open Items

### 2026-06-12 - Wave 2 Procedure Editor WIP Gate Rechecked Before CONS-M1

- Area: Consolidation coordinator / Wave 2 gating / procedure editor
- Status: fixed
- Severity: P1
- Uncertainty: The consolidation contract required the coordinator to land or explicitly discard the historical uncommitted WIP on `apps/console/app/build/components/procedures/[name]/page.tsx` before starting `CONS-M1`, because that file becomes M1-owned in Wave 2.
- Default action taken: Re-checked the current integration checkout before Wave 2 dispatch. `apps/console/app/build/components/procedures/[name]/page.tsx` is clean in the coordinator worktree, with no remaining uncommitted product-code WIP on that file. The only residual dirty state in this checkout is unrelated receipt drift under `.artifacts/delivery-audit/2026-06-12/procedure-v2-worktree/`.
- Why this default: Wave 2 must not start on top of ambiguous local edits to the Procedure editor. A clean file is sufficient proof that the earlier WIP gate is no longer blocking this checkout.
- Evidence: `git status --short 'apps/console/app/build/components/procedures/[name]/page.tsx' doc`; current file readback from `apps/console/app/build/components/procedures/[name]/page.tsx`; `doc/handoffs/CODEX_GOAL_CONSOLIDATION_M1_M7.md`
- Production URL / screenshot / receipt: Not applicable; coordinator gating decision only.
- Owner decision needed: None for this checkout. `CONS-M1` may claim this file under the Wave 2 owned-file list.
- Follow-up owner: none

### 2026-06-12 - CONS-M2 Production Resume Preserved ProcedureRun But Case Truth Drifted

- Area: Consolidation M2 / production resume / case truth
- Status: fixed
- Severity: P1
- Uncertainty: Historical only. The first production durability proof preserved the same `ProcedureRun` across restart, but the top-level `Case` row still drifted to `created` / `general` after `resumeTrigger`.
- Default action taken: Landed hotfix deploys `305c5731` and `850228c8` to align durable `Case` truth both when `start_procedure` begins and when a paused human handoff resumes through `human_task_result`. Re-ran the full production chain on a fresh case after deploy.
- Why this default: Resume truth is part of the customer-visible case state and operator metrics. Leaving `ProcedureRun` correct while the top-level `Case` lies would keep Operate, exports, and follow-up routing misleading.
- Evidence: `.artifacts/delivery-audit/2026-06-12/cons-m2/truth-drift-hotfix/20260612T175502/case-after-step2.json`; `.artifacts/delivery-audit/2026-06-12/cons-m2/truth-drift-hotfix/20260612T175502/case-after-resume.json`; `.artifacts/delivery-audit/2026-06-12/cons-m2/truth-drift-hotfix/20260612T175502/db-after-resume.json`; `.artifacts/delivery-audit/2026-06-12/cons-m2/truth-drift-hotfix/20260612T175502/step3-resume.sse`; `.artifacts/delivery-audit/2026-06-12/cons-m2/receipt.md`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/operate/conversations/cases/m2truth2_20260612T175502`; proof directory `.artifacts/delivery-audit/2026-06-12/cons-m2/truth-drift-hotfix/20260612T175502/`
- Owner decision needed: None for the drift itself. This specific P1 is closed.
- Follow-up owner: none

### 2026-06-12 - CONS-M2 Production Restart Receipt Still Pending After Local Migration Proof

- Area: Consolidation M2 / ProcedureRun durability / migration verification
- Status: fixed
- Severity: P0
- Uncertainty: Historical only. The lane previously lacked the required production restart/resume receipt.
- Default action taken: Deployed `91196386` to `deploy/main`, verified migration `202606120001_add_procedure_run` on the host, created a fresh post-deploy production case, drove it to a real `waiting_human` pause, verified the paused `ProcedureRun` row existed in production DB, restarted `intera-console` again mid-run, resolved the same human task, and resumed via `/api/messages` `resumeTrigger`. This receipt remains valuable as historical M2 durability proof, but the owner later replaced the terminal contract: as of 2026-06-15, successful human handoff finalizes the Procedure instead of leaving it paused/resumable.
- Why this default: The commercial acceptance contract requires the proof on `https://demo.anytrans.ai`, not only local tests or synthetic memory seams.
- Evidence: `.artifacts/delivery-audit/2026-06-12/cons-m2/receipt.md`; `.artifacts/delivery-audit/2026-06-12/cons-m2/production-proof/production-health-after-restart.json`; `.artifacts/delivery-audit/2026-06-12/cons-m2/production-proof/production-case-after-resume.json`; `.artifacts/delivery-audit/2026-06-12/cons-m2/production-proof/production-procedure-run-after-resume.txt`; `.artifacts/delivery-audit/2026-06-12/cons-m2/production-proof/m2proof2-step1-20260612T091036.sse`; `.artifacts/delivery-audit/2026-06-12/cons-m2/production-proof/m2proof2-step2-20260612T091036.sse`; `.artifacts/delivery-audit/2026-06-12/cons-m2/production-proof/m2proof2-step3-resume-20260612T091036.sse`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai`; case detail proof at `https://demo.anytrans.ai/operate/conversations/cases/cmqaphvd60000qjb7rpqlk2ws`; screenshots under `.artifacts/delivery-audit/2026-06-12/cons-m2/screenshots/`
- Owner decision needed: None for the production durability receipt itself.
- Follow-up owner: none

### 2026-06-12 - Wave 2 CONS-M1 Was Initially Started On A Stale Wave-1 Branch Base

- Area: Consolidation coordinator / Wave 2 dispatch baseline
- Status: fixed
- Severity: P1
- Uncertainty: The first `CONS-M1` dispatch accidentally started from `codex/cons-wave1-wip` at `47017d9a`, which did not contain the later `main` baseline including `CONS-M2` closure and downstream mainline fixes. Continuing M1 there would have built on a stale Wave 1 base.
- Default action taken: Stopped the stale-base worker before any M1-owned code edits landed, verified the worktree had no M1 code modifications, moved the coordinator checkout to a fresh `main`-derived branch (`codex/cons-m1-main-base`), synchronized the finalized `CONS-M2` production evidence into the current checkout, and prepared to respawn `CONS-M1` from the corrected baseline.
- Why this default: M1 is a Wave 2 sequential runtime/schema lane. Running it on a stale pre-closure Wave 1 branch would create false review noise and risk replaying work against the wrong runtime truth.
- Evidence: `git log --oneline --decorate --graph --left-right --cherry-pick --boundary 47017d9a...main`; `git status --short`; `git switch -c codex/cons-m1-main-base main`; coordinator thread record showing worker `019ebb54-7407-7552-8d29-335a97889ed2` shut down before owned-file edits landed
- Production URL / screenshot / receipt: Not applicable; coordinator dispatch correction only.
- Owner decision needed: None. Respawn `CONS-M1` only from the `main`-derived baseline.
- Follow-up owner: coordinator

### 2026-06-12 - CONS-M5 Raw-Access Guard Uses Reviewed Allowlist For Out-Of-Lane Admin Routes

- Area: Tenant isolation / admin API seam / consolidation M5
- Status: default-applied
- Severity: P2
- Uncertainty: The M5 dispatch names 11 admin sub-module route files for migration, but this spawned checkout has additional admin API files containing `repo.raw` or direct Prisma access because parallel lanes and older org-scoped routes are also present. Migrating those additional routes would change behavior outside the CONS-M5 owned-file list, especially routes with no-agent fallback, org-scoped parent resources, playground export/session reads, and helper-only modules.
- Default action taken: Migrated only the 11 owned admin sub-module route files to `defineRoute({ scope: 'agent' })`, removed their hand-rolled `assertAgentInOrg` calls, and added `scripts/check-isolation-seam.mjs` with a reviewed allowlist for the remaining raw-access admin files. The guard fails any new unreviewed raw/direct-Prisma admin route without `scope: 'agent'`.
- Why this default: It mechanizes the customer-2 isolation seam for the lane-owned sub-module routes without silently changing unrelated admin route semantics during concurrent consolidation work.
- Evidence: `.artifacts/delivery-audit/2026-06-12/cons-m5/summary.md`; `scripts/check-isolation-seam.mjs`; `apps/console/app/api/admin/tools/__tests__/cross-org-isolation.test.ts`
- Production URL / screenshot / receipt: No production deploy performed for this internal API seam lane. Local guard red-on-canary/green-after and keyless tests are recorded in `.artifacts/delivery-audit/2026-06-12/cons-m5/summary.md`.
- Owner decision needed: Confirm whether a later lane should convert currently allowlisted raw-access admin files to explicit `scope: 'agent'` or `scope: 'org'` declarations once their route semantics are reviewed.
- Follow-up owner: architect / delivery lead

### 2026-06-12 - CONS-M7A Local Screenshot Gate Recovered After Smoke Harness Isolation Fix

- Area: Receipt CI / browser smoke / consolidation M7A
- Status: fixed
- Severity: P2
- Uncertainty: The first local full smoke attempt was a false negative from the harness itself: `scripts/smoke-console-auth.mjs` reused one Playwright page across route transitions, so aborted fetches from the previous route could be misattributed to the next route as console errors.
- Default action taken: Restored the local smoke prerequisites (local Postgres on `5434`, seeded owner login, healthy dev server on `127.0.0.1:3001`), changed the smoke harness to open a fresh page per route, then reran `npm run smoke:console` and two consecutive full `npm run ci:receipts` bundles. All phases passed, including authenticated desktop/mobile golden-loop screenshots.
- Why this default: M7A is only as trustworthy as its harness. A route-isolated browser page is the smallest fix that removes cross-route console contamination without changing product/runtime behavior.
- Evidence: `.artifacts/final-smoke/m7a-rerun/summary.json`; `.artifacts/delivery-audit/2026-06-12/cons-m7a/20260612T163547/summary.md`; `.artifacts/delivery-audit/2026-06-12/cons-m7a/20260612T163659/summary.md`; `scripts/smoke-console-auth.mjs`
- Production URL / screenshot / receipt: This fix closes the local smoke harness gap only. Production acceptance for any user-facing lane remains governed by `https://demo.anytrans.ai` per `PLATFORM_DELIVERY_AUDIT_GOALS.md`.
- Owner decision needed: None for local lane truth. If desired later, install the documented cron/systemd-timer on the host and archive two production-host automated bundles as an ops follow-up.
- Follow-up owner: none

### 2026-06-12 - Consolidation Spec And Dispatch Docs Need Repo-Relative Landing

- Area: Docs compression / consolidation dispatch
- Status: fixed
- Severity: P2
- Uncertainty: The authoritative M1-M7 consolidation dispatch, spec, and execution plan were initially present only as coordinator reference material on the desktop main checkout, which forced spawned lanes to treat them as read-only authority instead of normal repo-relative docs.
- Default action taken: The coordinator landed the three consolidation docs into the repo (`doc/handoffs/CODEX_GOAL_CONSOLIDATION_M1_M7.md`, `doc/spec/2026-06-12-architecture-consolidation-modules-spec.md`, `doc/to-do/2026-06-12-consolidation-m1-m7-execution-plan.md`) and simplified the live read-first entries back to normal repo-relative links.
- Why this default: Consolidation implementation lanes need repo-local normative docs; leaving them desktop-only would keep dispatch brittle and make documentation truth machine-dependent.
- Evidence: `doc/handoffs/CODEX_GOAL_CONSOLIDATION_M1_M7.md`; `doc/spec/2026-06-12-architecture-consolidation-modules-spec.md`; `doc/to-do/2026-06-12-consolidation-m1-m7-execution-plan.md`; `.artifacts/delivery-audit/2026-06-12/cons-m7b/summary.md`
- Production URL / screenshot / receipt: Not applicable; docs-only lane.
- Owner decision needed: None.
- Follow-up owner: architect / coordinator

### 2026-06-12 - Procedure v2 Merge-Candidate Is Green In Code But Missing Authenticated UI Proof

- Area: Procedure authoring / runtime / local verification
- Status: default-applied
- Severity: P2
- Uncertainty: This lane is green for local merge-candidate review on top of latest `main`, but it still lacks one critical proof class: authenticated local Procedure editor screenshots. The runtime/build/tests side is green. The remaining gap is environment-side. The repo runbook expects a local DB-backed Console on `127.0.0.1:3001`, but `localhost:5434` is currently an SSH listener rather than the expected local Postgres container, the sibling `.env.local` points at that tunnel, and the tunnel no longer accepts the assumed local `intera:intera` credentials. An isolated `initdb` attempt also hung at the host level, and a temporary Homebrew `postgresql@16` service could be started/stopped safely but never exposed a usable socket/TCP listener for this lane. Separately, live `llm_eval` provider proof was still not run because the shell exposes no usable provider credentials.
- Default action taken: Rebased the branch onto latest `main`, fixed the `build:console` blocker by removing the redundant legacy `/admin/integrations` and `/admin/memory` pages, closed the ProcedureRun false positive by pausing successful persisted handoffs with a clear terminal reason, kept `runtime_signal` as hint-only, sanitized `llm_eval` metadata to prompt-hash form, blocked v2 `confirmedFacts` writes at the `/api/messages` boundary while preserving v1 behavior, tightened the Procedure editor copy/state affordances, archived the Fin reference image, and marked the lane `PARTIAL PASS` instead of claiming authenticated UI proof that does not exist.
- Why this default: It closes the code-side P0/P1 blockers for merge-candidate review without pretending that injected proof equals live provider proof or that an unauthenticated/auth-gate screenshot equals a verified editor smoke pass.
- Evidence: `.artifacts/delivery-audit/2026-06-12/procedure-v2-worktree/baseline-audit.md`; `.artifacts/delivery-audit/2026-06-12/procedure-v2-worktree/summary.md`; `.artifacts/delivery-audit/2026-06-12/procedure-v2-worktree/procedure-v2-runtime-receipt.json`; `.artifacts/delivery-audit/2026-06-12/procedure-v2-worktree/procedure-v2-runtime-receipt.md`
- Production URL / screenshot / receipt: No production deploy was performed. Runtime proof lives at `.artifacts/delivery-audit/2026-06-12/procedure-v2-worktree/procedure-v2-runtime-receipt.json`. The Fin reference image is archived at `.artifacts/delivery-audit/2026-06-12/procedure-v2-worktree/reference-fin-procedure-ui.png`. Strongest actual local browser evidence remains the auth/degraded gate screenshot `.artifacts/delivery-audit/2026-06-12/procedure-v2-worktree/screenshots/procedure-route-auth-gate.png`, which is explicitly not authenticated editor proof.
- Owner decision needed: Confirm whether injected runtime-proof receipts are sufficient before a separate live-provider proof lane. Confirm the production `llm_eval` provider/model/timeout/failure policy. Confirm whether `no_progress_loop` should stay at the current default threshold of `3` customer messages without progress. Confirm whether existing saved v1 procedures should remain lazy-compatible or get a later explicit migration plan. Resolved on 2026-06-15: successful human handoff on any channel finalizes the Procedure, so `paused + reason=waiting_human` is no longer the desired terminal contract. Confirm whether Delivery Agent 1 may merge/cherry-pick before authenticated local editor screenshots are available, or whether a dedicated local env/smoke lane must land first.
- Follow-up owner: founder / architect / delivery lead

### 2026-06-12 - Provider Transcript Persistence Defaults

- Area: AgentLoop / message persistence / provider transcript durability
- Status: default-applied
- Severity: P1
- Uncertainty: The spec requires durable provider transcript truth but does not mandate a backfill job for legacy rows, an exact payload-retention cap for historical tool results, or whether compact windows must obey a hard message count when that would split an Anthropic `tool_use` / `tool_result` pair.
- Default action taken: Added nullable JSON `Message.providerContent` and `Message.providerMeta`; left legacy rows backward-compatible without destructive backfill; persisted full first-class provider transcript blocks for new assistant `tool_use` and internal user `tool_result` rows; hid internal provider rows from customer-visible message APIs; made provider windows pair-aware even when preserving the matching assistant row exceeds the nominal recent-message count; added trace/receipt counters for persisted transcript, checked pairs, repairs, orphan drops, legacy skips, and compact pair summaries.
- Why this default: Nullable JSON preserves production compatibility and keeps the reversible runtime truth alongside existing display fields. Pair-aware windows are safer than honoring a hard count that can create invalid provider input. Avoiding a backfill prevents historical lossy rows from being rewritten as false evidence.
- Evidence: `apps/console/lib/agent/provider-transcript.ts`; `apps/console/lib/agent/message-builder.ts`; `apps/console/lib/agent/loop.ts`; `apps/console/app/api/messages/route.ts`; `packages/shared/prisma/migrations/20260612000000_add_message_provider_transcript/migration.sql`; `.artifacts/delivery-audit/2026-06-12/session-transcript-tool-results/summary.md`
- Production URL / screenshot / receipt: Local receipt path planned at `.artifacts/delivery-audit/2026-06-12/session-transcript-tool-results/summary.md`; no push or production deploy authorized for this branch.
- Owner decision needed: Confirm whether historical Message rows need an explicit backfill/reindex job, whether provider tool-result payload retention should be capped or redacted beyond current trace truncation, and whether pair-aware provider windows may continue to exceed the nominal message count when required to keep protocol pairs valid.
- Follow-up owner: architect / delivery lead

### 2026-06-11 - LiveChat Webhook URL Broke Across Agent Publish

- Area: LiveChat / Agent publish / integration boundary
- Status: fixed
- Severity: P0
- Uncertainty: Publishing `J1B v3` activated `cmq4q82mx0001qj32gt8htfiq` and deactivated `cmq4mvv5o0001qj5yfl84kfl0`, but the external LiveChat app was still calling the old per-agent webhook URL under the `v1` id. Production logs then showed repeated `Agent config "cmq4mvv5o0001qj5yfl84kfl0" not found or not active`, and user-visible chats received no reply after publish.
- Default action taken: Treated webhook URL stability as a production blocker and fixed the per-agent LiveChat webhook route so an inactive requested Agent id resolves to the current active config in the same Agent family instead of returning `not active`.
- Why this default: The updated goal/spec now define the webhook URL as part of the channel/workspace integration boundary, not the runtime version boundary. Requiring a manual external webhook URL rewrite after every publish would violate the acceptance contract and make publish unsafe for customer-facing LiveChat.
- Evidence: `.artifacts/delivery-audit/2026-06-11/livechat-chain/webhook-stability-after-publish/summary.md`; `.artifacts/delivery-audit/2026-06-11/livechat-chain/webhook-family-anchor-post-deploy/summary.md`
- Production URL / screenshot / receipt: Production deploy `1354facf` first proved the old webhook URL `https://demo.anytrans.ai/api/livechat/webhook/default/cmq4mvv5o0001qj5yfl84kfl0` still routed into active `J1B v3` after publish. Follow-up deploy `995310a1` then proved the Console/admin surface now exposes that same family-root webhook identity consistently: active `v3`, inactive/root `v1`, and the admin config API all report `webhookAgentConfigId=cmq4mvv5o0001qj5yfl84kfl0`, the screenshots show the same fixed URL in each version view, and a post-deploy no-op webhook probe still returns HTTP `200`. Secrets remain redacted in the receipts.
- Exact blocker reproduction:
  - Publish `cmq4q82mx0001qj32gt8htfiq` so `cmq4mvv5o0001qj5yfl84kfl0` becomes inactive.
  - Keep the external LiveChat app on the old `v1` webhook URL.
  - Send a new LiveChat message.
  - Production logs show `Agent config "cmq4mvv5o0001qj5yfl84kfl0" not found or not active`, and no reply reaches the customer.
- Attempted fixes / checks: Verified publish state via production API and Postgres; confirmed `v3` was active and the old webhook path was receiving traffic; added route-level fallback logic plus regression coverage; ran focused vitest, `git diff --check`, and `npx tsc --noEmit -p apps/console/tsconfig.json`; deployed `1354facf`; verified the old URL returns HTTP `200` after publish and resolves into active `v3` behavior in production traces.
- Why no workaround is safe: Telling operators to manually rotate the external webhook URL on every publish keeps the integration brittle and makes publish a customer-facing outage risk. The acceptance bar now explicitly forbids that boundary leak.
- Current operator action: Keep the existing external J1B webhook URL fixed. The current production J1B endpoint already uses `cmq4mvv5o0001qj5yfl84kfl0` (`J1B v1`, the family root anchor used in the stability proof), and J1B does **not** need another webhook rewrite tomorrow.
- Residual implementation note: Closed for the current delivery lane. Production ingress, admin API, and Console copy now all agree on the same family-stable webhook identity after deploy `995310a1`. If future work ever reintroduces version-scoped webhook display or requires a manual external webhook rewrite, reopen this item immediately as a P0 regression.
- Regression rule: If J1B ever requires another manual webhook rewrite after publish/version switching, reopen this item as a P0 production regression immediately.
- Owner decision needed: None for the stability fix itself. Future LiveChat product work should preserve this invariant.
- Follow-up owner: coding-team lead / delivery lead

### 2026-06-11 - LiveChat Explicit Human Request Paused Before Real Handoff

- Area: LiveChat / human handoff / Procedure / traceability
- Status: fixed
- Severity: P0
- Uncertainty: Production explicit-human requests could still fail acceptance in two ways: the `human_support_requested` procedure could pause at `ask_user_questions` before creating a real HumanTask, and even successful human-task creation did not persist a standalone `escalated` trace action. That left the customer-visible transfer copy ahead of the durable audit evidence.
- Default action taken: Treated this as a production blocker, updated the active J1B production `human_support_requested` case type to an immediate one-step handoff path, patched runtime trace persistence to write `escalated` alongside `human_task_created`, and redeployed.
- Why this default: A human-transfer promise without `waiting_human`, a visible HumanTask, and a persisted `escalated` trace would make LiveChat handoff acceptance untrustworthy and strand operators without a clean audit trail.
- Evidence: `.artifacts/delivery-audit/2026-06-11/livechat-chain/handoff-trace-closure/summary.md`; historical failure receipt `.artifacts/delivery-audit/2026-06-11/livechat-chain/handoff-audit-final/summary.md`
- Production URL / screenshot / receipt: After deploy `964979bb`, a synthetic explicit-human probe through the stable old J1B webhook path produced `case_20260611_112310_d9e5a730` with `status=waiting_human`, `1` HumanTask, and traces containing both `human_task_created` and `escalated`. The pre-fix probe `case_20260611_111615_9db93108` reached `waiting_human` but still lacked persisted `escalated`, and the earlier widget audit stalled at `collect_handoff_summary`.
- Attempted fixes / checks: Confirmed the production gap from case readback and traces; changed the active production case-type data for `human_support_requested`; added `writeEscalated(...)` persistence in `apps/console/lib/agent/trace.ts`, `apps/console/lib/agent/loop.ts`, `apps/console/lib/agent/case-agent-loop.ts`, and `apps/console/lib/agent/tool-interceptor.ts`; expanded `apps/console/lib/agent/__tests__/unit/hook-engine-runtime.test.ts`; ran focused vitest, `git diff --check`, and `npx tsc --noEmit -p apps/console/tsconfig.json`; pushed local main commit `0088de5f`; deployed as `964979bb`; rechecked the stable old webhook path and post-deploy synthetic handoff traces on production.
- Why no workaround is safe: Asking customers for more details before honoring an explicit human request, or telling operators to ignore missing `escalated` traces, would break the stated handoff contract and make the queue state harder to trust.
- Owner decision needed: None. Keep explicit human requests on the immediate-handoff path unless product policy intentionally changes later.
- Follow-up owner: coding-team lead / delivery lead

### 2026-06-11 - Playground Export Lost Operate Timing Metrics

- Area: Operate / traceability / Playground export
- Status: fixed
- Severity: P0
- Uncertainty: Historical only. Playground export initially preserved the conversation/case copy and token totals, but it could still lose or under-report the timing evidence required by the customer-ready dispatch: Conversation detail showed `Tool Phase 0ms`, and exported ProcedureRun detail could miss per-iteration `LLM Time` because `Iteration Snapshot` `loop_decision` rows were not preserved into the canonical export trace.
- Default action taken: Treated this as a production traceability blocker, preserved `Iteration Snapshot` timing rows in the export pipeline, updated Conversation metric computation to prefer structured iteration timing over collapsed timestamps, redeployed, and re-ran the full Playground-to-Operate production proof.
- Why this default: The dispatch explicitly requires Playground export to preserve token, latency, and trace metrics end to end. Copy-only export without truthful timing evidence would make Operate misleading during incident review.
- Evidence: `.artifacts/delivery-audit/2026-06-11/traceability-production/summary.md`; `.artifacts/delivery-audit/2026-06-11/traceability-production/playwright-operate-export-traceability-summary.json`
- Production URL / screenshot / receipt: Production main commit `09ed4459` and deploy commit `00e798b0` now export the same Playground run into Operate with linked chat id `pg_saved_1781180385221_kdqcj4`, case id `cmq9gt96t0000qj4qemh7vvbw`, `34` traces, `7` LLM responses, `9` tool results, `25,841` total tokens, `wallTimeMs=21565`, and visible Operate timing proof in screenshots `.artifacts/delivery-audit/2026-06-11/traceability-production/operate-conversation-export.png` (`Wall Time 21.0s`, `Tool Phase 2.9s`) and `.artifacts/delivery-audit/2026-06-11/traceability-production/operate-case-export.png` (per-iteration `LLM Time` plus tool timings).
- Attempted fixes / checks: Added export coverage in `apps/console/lib/agent/__tests__/unit/trace-aggregator.test.ts`, `apps/console/app/api/admin/playground/__tests__/save-to-chat.test.ts`, and `apps/console/components/operate/__tests__/conversation-metrics.test.ts`; ran focused vitest, `git diff --check`, `npx tsc --noEmit -p apps/console/tsconfig.json`, `env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test`, and `rm -rf apps/console/.next && npm run build:console`; then re-ran the production Playwright export receipt on `https://demo.anytrans.ai`.
- Why no workaround is safe: Manually reading raw traces or relying on token totals alone would not prove that Operate preserved the timing metrics operators use during incident review.
- Owner decision needed: None.
- Follow-up owner: coding-team lead / delivery lead

### 2026-06-10 - Production Deploy Commit And Hotfix Parity

- Area: Deploy / production acceptance
- Status: fixed
- Severity: P0
- Uncertainty: Production health was green, but `https://demo.anytrans.ai` was not proven to run the local Gate A-D implementation. As of 2026-06-11 00:30 CST, after `git fetch --all --prune`, `HEAD`, `origin/main`, and `deploy/main` all pointed to `e07445f355ab3bd131f7a3dabe06b69109c4a34e`, while the Gate A-D implementation remained 24 dirty/untracked worktree entries. The hotfix worktree was on `codex/profile-menu-adaptive-spacing` at `43f3eb2c`, behind current `deploy/main` by 5, with untracked `.artifacts/` and `doc/strategy/hooks-layout-preview.html`.
- Default action taken: Treated production health as availability proof only, not acceptance proof. After owner approval on 2026-06-11, staged the exact Gate A-D allowlist, committed `8e8c43e20a83d3d567f79d5b90e39de80553b946`, and deployed with `git push deploy main`.
- Why this default: The dispatch requires production proof, and accepting prior screenshots or a healthy endpoint without commit parity could hide drift between local, deploy, and production.
- Evidence: `.artifacts/delivery-audit/2026-06-10/phase-0/baseline.md`; `.artifacts/delivery-audit/2026-06-10/phase-1-pilot-gate-a/summary.md`; `.artifacts/delivery-audit/2026-06-10/phase-1-pilot-gate-b/summary.md`; `.artifacts/delivery-audit/2026-06-10/phase-1-pilot-gate-c/summary.md`; `.artifacts/delivery-audit/2026-06-10/phase-1-pilot-gate-d/summary.md`; `.artifacts/delivery-audit/2026-06-11/production-parity-audit/summary.md`; `.artifacts/delivery-audit/2026-06-11/production-post-deploy/summary.md`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/api/health` healthy at 2026-06-10 22:22 CST, 2026-06-11 00:22/00:25/00:29 CST, and post-deploy at 2026-06-11 10:02 CST. Deploy hook applied migration `20260610000000_add_pilot_persistence`, built, restarted, and returned healthy local server status. Post-deploy unauthenticated probes still return HTTP 307 for `/build/pilot-lab` and HTTP 401 for `POST /api/admin/pilot/release-handoffs/generate`, proving auth protection only.
- Exact blocker reproduction:
  - `git fetch --all --prune && git rev-parse HEAD && git rev-parse origin/main && git rev-parse deploy/main && git status --short | wc -l` in `/Users/curtis/Desktop/intera-agent` returns the same `e07445f355ab3bd131f7a3dabe06b69109c4a34e` for all three refs and `24` dirty/untracked entries.
  - `curl -sS -D - https://demo.anytrans.ai/api/health` returns HTTP 200 with `"db":"connected"`.
  - `curl -sS -D - https://demo.anytrans.ai/build/pilot-lab` returns HTTP 307 to login, so authenticated UI proof is still required.
  - `curl -sS -D - -X POST https://demo.anytrans.ai/api/admin/pilot/release-handoffs/generate ...` returns HTTP 401 without a session, which is auth proof only.
- Attempted fixes / checks: Completed local Gate A-D build and preflight receipts; fixed the local smoke readiness timeout; refreshed all remotes; checked the hotfix worktree; probed production health and protected routes without credentials; documented an exact commit-boundary allowlist in the production parity audit; deployed after owner approval; verified production health after deploy.
- Why no workaround is safe: This specific deploy parity uncertainty is resolved. Final Gate A-D acceptance remains blocked by the separate authenticated production login item below.
- Owner decision needed: None for deploy parity. Production authentication is now the active blocker.
- Next recommended step: Resolve the authenticated production testing path below, then run production Pilot Lab acceptance on `https://demo.anytrans.ai`.
- Follow-up owner: owner / delivery lead

### 2026-06-11 - Production Authenticated Smoke Credentials Invalid

- Area: Production auth / Pilot acceptance
- Status: fixed
- Severity: P0
- Uncertainty: The local smoke harness credentials were invalid, so production proof initially stalled. During the 2026-06-11 Playground KB hotfix audit, the owner-approved authenticated Chrome session path became available and production UI/runtime verification could proceed.
- Default action taken: Kept the broken smoke credentials out of the acceptance path and used the explicitly approved authenticated browser session instead. Did not guess credentials or bypass auth.
- Why this default: The dispatch required real authenticated production proof, and the approved live session was narrower and safer than inventing a new login path.
- Evidence: `.artifacts/delivery-audit/2026-06-11/production-post-deploy/summary.md`; `.artifacts/delivery-audit/2026-06-11/playground-kb-hotfix-production/summary.md`
- Production URL / screenshot / receipt: `GET https://demo.anytrans.ai/api/health` returned HTTP 200 with DB connected after deploy. The approved authenticated session on `https://demo.anytrans.ai/build/pilot-lab?tab=playground` then produced the KB hotfix production proof recorded in `.artifacts/delivery-audit/2026-06-11/playground-kb-hotfix-production/summary.md`.
- Exact blocker reproduction:
  - Run `SMOKE_BASE_URL=https://demo.anytrans.ai SMOKE_OUTPUT_DIR=.artifacts/production-smoke/2026-06-11-post-deploy npm run smoke:console`.
  - The harness loads local configured credentials, calls `/api/health` successfully, then receives HTTP 401 from `/api/auth/login`.
- Attempted fixes / checks: Confirmed production deploy, migration, build, restart, public health, `/build/pilot-lab` login redirect, and protected Gate D endpoint 401. Later reused the owner-approved authenticated Chrome session and completed live Playground KB hotfix verification there.
- Why no workaround is safe: Resolved for this audit. The remaining open product blocker is not authentication; it is the direct Tools route render regression logged below.
- Owner decision needed: None for authentication on this audit path.
- Next recommended step: Keep the local smoke credentials issue separate from product verification and fix it only if the automated production smoke path is still desired.
- Follow-up owner: owner / delivery lead

### 2026-06-11 - Production Tools Route Blank During KB Hotfix Audit

- Area: Build / Components / production acceptance
- Status: fixed
- Severity: P0
- Uncertainty: The original blocker came from invalid evidence rather than a stable production Tools-route failure. The first manual screenshot captured the wrong window, and an early Playwright nav probe briefly caught the client-side `Loading…` transition before the route had settled.
- Default action taken: Re-ran the KB hotfix production proof with Playwright against `https://demo.anytrans.ai`, captured corrected Knowledge and Tools screenshots, and required direct-load, refresh, reopen, and settled in-app navigation proof before closing the blocker.
- Why this default: The acceptance required truthful Tools UI evidence. Deterministic browser proof was safer than assuming the route was either broken or healthy from a bad PNG.
- Evidence: `.artifacts/delivery-audit/2026-06-11/playground-kb-hotfix-production/summary.md`; `.artifacts/delivery-audit/2026-06-11/playground-kb-hotfix-production/playwright-kb-tools-evidence.json`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/build/components/tools`; corrected screenshots `[tools-page-direct-playwright.png]`, `[tools-knowledge-search-tools-playwright.png]`, and `[tools-page-via-navigation-playwright.png]` are recorded under `.artifacts/delivery-audit/2026-06-11/playground-kb-hotfix-production/`.
- Exact blocker reproduction:
  - Historical only: `[tools-route-blank.png]` is invalid and does not prove a truthful Intera Tools render.
  - Corrected Playwright proof on 2026-06-11 10:57 CST showed direct load, refresh, reopen, and settled in-app nav all rendering the Tools workspace for `J1B v3 draft`.
- Attempted fixes / checks: Re-ran production proof with the provided test account, selected `J1B v3 draft`, captured Knowledge/Tools screenshots, verified `kb_search_*` entries on both pages, and recorded route diagnostics showing no console errors, page errors, failed requests, or `>=400` responses on the settled Tools route. No product code change or deploy was required because the route rendered correctly once the capture path was fixed.
- Why no workaround is safe: Resolved. The corrected production proof removes the need for any speculative route fix or alternate acceptance path.
- Owner decision needed: None.
- Follow-up owner: coding-team lead

### 2026-06-11 - Scenario Receipts Lost After Standalone Redeploy

- Area: Pilot Lab / Scenario receipts / production persistence
- Status: fixed
- Severity: P0
- Uncertainty: The first authenticated production Gate A-D receipt run created a durable Pilot session, proposals, receipt-linked fix proposal, and release handoff, but after the later mobile-header redeploy the same agent showed `Not validated` and `/api/admin/scenarios?agentConfigId=...` returned empty `scenarios` and `receipts`. Pilot session state survived while Scenario receipt state did not.
- Default action taken: Treated the empty Scenario readback as a production-blocking durability bug, traced the default store path to `process.cwd()` under Next standalone, changed `apps/console/lib/scenarios/store.ts` to resolve the repo root before defaulting `.intera-agent-runtime/scenarios.json`, added focused regression tests, and deployed `d136258f96dabe47b25554dccb9b00f87229766c`.
- Why this default: Gate C/D receipts are supposed to be durable commercial evidence. If redeploy wipes them, Pilot validation truth, release readiness, and rerun proof all become misleading.
- Evidence: `.artifacts/delivery-audit/2026-06-11/production-authenticated-acceptance/scenario-store-persistence-summary.md`; `.artifacts/delivery-audit/2026-06-11/production-authenticated-acceptance/scenario-store-persistence-baseline/playwright-production-acceptance-summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-receipt-durability-gate-post-deploy/playwright-j1b-post-deploy-recheck-summary.json`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/build/pilot-lab`; authenticated baseline created Scenario `pilot_acceptance_probe_20260611024311_runtime_fail`, runtime-backed receipt `scn_ef18349f-691d-48d7-81a4-7188c2069dde`, fix proposal `cmq8w8g2f0011qjtoz2o81ngv`, and release handoff `cmq8w8g4w001bqjtot7wa0baw`, all recorded in the baseline receipt above. After the case-type evidence deploy `3a20d0a5`, the post-deploy recheck also confirmed the earlier J1B receipt `scn_9e1aadf8-eb9a-4740-a98f-d1dcbf0568cd` still existed in `/api/admin/scenarios` and remained visible after refresh and reopen.
- Exact blocker reproduction:
  - Before the fix, authenticated production readback after redeploy showed `GET /api/admin/pilot/sessions/current?agentConfigId=cmq4q82mx0001qj32gt8htfiq` still referencing receipt `scn_fdc23441-1b71-444a-9957-84c92ccdb036`.
  - The matching `GET /api/admin/scenarios?agentConfigId=cmq4q82mx0001qj32gt8htfiq` returned `scenarios: []`, `receipts: []`, and `validation.state: "Not validated"`.
  - Local inspection showed `apps/console/lib/scenarios/store.ts` defaulted to `path.join(process.cwd(), '.intera-agent-runtime', 'scenarios.json')`, while `apps/console/.next/standalone/apps/console/server.js` runs `process.chdir(__dirname)`, so standalone writes landed under `.next/standalone/apps/console/.intera-agent-runtime/` and were lost on rebuild.
- Attempted fixes / checks: Added `apps/console/lib/scenarios/store.test.ts`; reran `scenarios`, `config-pilot`, `pilot-gate-a`, and `agent-template` vitest suites; reran `git diff --check`, `npx tsc --noEmit -p apps/console/tsconfig.json`, and `rm -rf apps/console/.next && npm run build:console`; pushed/deployed `d136258f`; reran authenticated production acceptance and confirmed the new receipt was present in `/api/admin/scenarios` readback before the next deploy; later deployed `3a20d0a5` and reran a post-deploy persistence check proving the prior J1B receipt still survived refresh and reopen.
- Why no workaround is safe: Relying on Pilot session pointers alone would hide missing Scenario truth. Manual DB edits or older screenshots would not prove durable receipt storage.
- Owner decision needed: None.
- Next recommended step: Keep treating receipt durability as an embedded gate for every J1B production scenario family; if any receipt disappears after a later deploy or restart, reopen this blocker immediately.
- Follow-up owner: coding-team lead / delivery lead

### 2026-06-11 - Scenario Authoring Has No Manual Console UI

- Area: Production config UX / Pilot Lab / Scenario setup
- Status: fixed
- Severity: P1
- Uncertainty: Historical only. Before the fix, `/admin/scenarios` redirected into Pilot Lab but the resulting production UI exposed only Scenario selection, validation, and receipt review. It did not expose a manual `New` / `Delete` / `Save scenario` authoring workflow for a config operator.
- Default action taken: First kept the gap visible and used the typed admin API for early J1B seed work. Then implemented manual Scenario authoring controls in Pilot Lab, deployed them on 2026-06-11, and reran production proof with Playwright against `https://demo.anytrans.ai`.
- Why this default: The owner explicitly asked for step-by-step console-UI validation that simulates a real config person. Once the gap was proven real, the console needed a truthful create/update/delete authoring path before this uncertainty could close.
- Evidence: Historical pre-fix gap proof: `.artifacts/delivery-audit/2026-06-11/scenario-ui-gap/summary.json`; screenshot `.artifacts/delivery-audit/2026-06-11/scenario-ui-gap/admin-scenarios-redirected.png`. Current fixed-state proof: `.artifacts/delivery-audit/2026-06-11/scenario-ui-gap/summary.md`; `.artifacts/delivery-audit/2026-06-11/scenario-ui-gap/manual-authoring-production/summary.json`; `.artifacts/delivery-audit/2026-06-11/scenario-ui-gap/manual-authoring-production-rerun/summary.json`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/build/pilot-lab` on draft `cmq4q82mx0001qj32gt8htfiq` now shows `New`, `Reset`, `Delete`, and `Save scenario` controls plus editable Scenario fields. Production Playwright proof created and deleted `manual_ui_delete_probe_20260611042820`, created and updated `duplicate_deposit_amount_first`, confirmed the earlier receipt `scn_9e1aadf8-eb9a-4740-a98f-d1dcbf0568cd` still survived the post-deploy window, then reran the manual-ui-authored duplicate-deposit Scenario to accepted receipt `scn_44bb0b6b-0c5a-4f4b-9d10-4a0e37fbcfb6`, which remained visible after immediate readback, refresh, and reopen.
- Owner decision needed: None for the UI gap itself. Historical follow-up complete: the final J1B 12-family / 36-flow matrix and long-session evidence are now recorded in `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/final-j1b-acceptance-index.md` and `.artifacts/delivery-audit/2026-06-11/j1b-long-session-post-fix/summary.md`.
- Next recommended step: Keep using the Pilot Lab authoring controls for future Scenario maintenance; keep receipt durability embedded in any newly accepted Scenario run.
- Follow-up owner: owner / product / coding-team lead

### 2026-06-11 - J1B Production Reply Language Drift On Withdrawal-Blocked Scenario

- Area: J1B production Playground / prompt quality / runtime UX
- Status: fixed
- Severity: P0
- Uncertainty: During production J1B scenario validation, `withdrawal_blocked_basic` initially returned Bengali customer-facing text and Bengali `ask_user_questions` labels even though the user message was Simplified Chinese. The runtime receipt still passed because the Scenario expected only `caseType`, `ask_user_questions`, and `finalStatus`, so language drift was not yet encoded as a receipt assertion.
- Default action taken: Treated the language drift as a same-area production quality defect, applied the prepared core-system-prompt language-lock block to the production J1B draft, and reran the same Scenario until the customer-facing reply plus `ask_user_questions` titles/descriptions/labels/placeholders were back in Simplified Chinese.
- Why this default: The dispatch requires the agent to answer in the customer's language, and adjacent defects discovered during J1B validation must be fixed or logged as blockers before continuing acceptance.
- Evidence: `.artifacts/delivery-audit/2026-06-11/j1b-language-lock-prompt/update-summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-language-lock-prompt/before-core-system-prompt.txt`; `.artifacts/delivery-audit/2026-06-11/j1b-language-lock-prompt/after-core-system-prompt.txt`; `.artifacts/delivery-audit/2026-06-11/j1b-language-lock-prompt/withdrawal_blocked_basic-rerun-accepted/summary.json`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/build/pilot-lab` on draft `cmq4q82mx0001qj32gt8htfiq`. Pre-fix runtime receipt `scn_9df271bd-958b-4234-bbde-6152ae9f0387` / trace `pg_1781153819139_mc0ay1` showed Bengali final reply and Bengali form labels in `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/withdrawal_blocked_basic/summary.json`. After the prompt tune, accepted rerun receipt `scn_323d4fd0-f152-4dd6-b229-0b38835dd9f4` / trace `pg_1781154000913_olpp3s` showed Chinese final reply plus Chinese `ask_user_questions` content and survived refresh/reopen.
- Exact blocker reproduction:
  - Run production `withdrawal_blocked_basic` before the prompt tune using the J1B draft.
  - Receipt `scn_9df271bd-958b-4234-bbde-6152ae9f0387` passes the existing Scenario checks, but the receipt evidence shows:
    - final response: `আপনার সমস্যা বুঝতে পেরেছি...`
    - `ask_user_questions` title/description/labels/placeholders also in Bengali
  - This contradicts the Chinese customer input and the prompt requirement to respond in the customer's language.
- Attempted fixes / checks: Applied the `## Output language lock` block to `coreSystemPrompt` through the authenticated production admin API; ran two phrase-assertion exploratory reruns (`scn_02f894a6-9bba-4f52-a08d-fc3363e9bd8b`, `scn_a39ac258-11d0-42d5-b32e-af6f2bdf78ca`) that already showed Chinese output but failed only because the ad hoc receipt phrases were too strict; then accepted rerun `scn_323d4fd0-f152-4dd6-b229-0b38835dd9f4` with Chinese runtime output and durability proof.
- Why no workaround is safe: Accepting the original receipt would hide a user-visible language defect in production. Manual interpretation without a rerun would not prove the production prompt had actually been corrected.
- Owner decision needed: None.
- Next recommended step: Reuse the language-lock prompt block for the remaining J1B production families and capture this rerun as the required targeted system-prompt-tuning proof in the final J1B receipt set.
- Follow-up owner: coding-team lead / delivery lead

### 2026-06-11 - J1B `security review` Wording Is Not Stable Enough For Counted Scenario Acceptance

- Area: J1B production Playground / scenario taxonomy / procedure routing
- Status: monitoring
- Severity: P1
- Uncertainty: During production validation, the exploratory wording `账户正在安全审核，不能提现` was not stable enough to use as a counted acceptance flow. Seeded under `withdrawal_blocked`, it routed to `account_wallet_frozen`; seeded under `account_wallet_frozen`, the same wording later routed back to `withdrawal_blocked`.
- Default action taken: Did not retune runtime or collapse the two Procedure families. Marked `security review` wording as ambiguous, excluded it from counted acceptance in both families, and replaced it with clearer flows:
  - `withdrawal_blocked_completed_conditions_escalation` for the unmet-conditions contradiction path
  - explicit `账号受限 / 钱包冻结 / 登录锁定` wording for the `account_wallet_frozen` family
- Why this default: Phase 4 separates `无法取款` from `账号/钱包被冻结`. Ambiguous wording is poor acceptance evidence. Clearer seed phrasing is safer than forcing the runtime to merge the taxonomies.
- Evidence: `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/withdrawal_blocked_security_hold/summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/withdrawal_blocked_security_hold-rerun/summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/account_wallet_frozen_security_review/summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/withdrawal_blocked_completed_conditions_escalation/summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/account_wallet_frozen_followup_member/summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/account_wallet_frozen_login_locked/summary.json`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/build/pilot-lab` on draft `cmq4q82mx0001qj32gt8htfiq`. Exploratory receipt `scn_fbe953a4-0885-46f8-8b3c-dbb797048d07` / trace `pg_1781154218937_e5u7kp` and rerun `scn_bd19630c-9418-4ff3-9f81-9ecedfceb263` / trace `pg_1781154817205_ld246p` did not stay on a stable family boundary. When re-seeded under `account_wallet_frozen`, exploratory receipt `scn_8807817d-14f5-41ba-be00-3d8f54499562` / trace `pg_1781155066232_r220zf` still routed to `withdrawal_blocked`. Accepted replacements were `scn_0268c441-d473-4ad1-9a5d-3750f61ea7aa` for `withdrawal_blocked`, plus `scn_fe0c8a18-a1bc-4f24-a6a3-64cff2ad9d11` and `scn_ce252e5e-bdfc-4edb-9561-eb18787309f1` for explicit `account_wallet_frozen` wording, all with refresh/reopen durability proof.
- Owner decision needed: None for continuing acceptance. If product later wants a single canonical home for `security review` wording, confirm whether it belongs under `withdrawal_blocked`, `account_wallet_frozen`, or an explicit split rule.
- Next recommended step: Avoid `security review` as a counted acceptance phrase. Keep using explicit `未满足提款条件` wording for `withdrawal_blocked` and explicit `账号受限 / 钱包冻结 / 登录锁定` wording for `account_wallet_frozen`.
- Follow-up owner: owner / product / delivery lead

### 2026-06-11 - J1B Promotion `Condition Conflict` Wording Is Narrower Than `Claim Failed`

- Area: J1B production Playground / scenario taxonomy / procedure routing
- Status: monitoring
- Severity: P1
- Uncertainty: During production validation, `promotion_condition_conflict` stayed stable only when the customer wording explicitly kept the contradiction form `满足条件了 / 达到要求了 / 条件都满足了` plus `还是参加不了`. Closely related wording such as `系统提示条件不满足` or `不能领取` repeatedly routed back to `promotion_claim_failed`, even when the customer also said the deposit and turnover requirements had already been completed.
- Default action taken: Did not retune runtime or merge the two Procedure families. Counted `promotion_condition_conflict` acceptance only with stable contradiction wording, and excluded the two drifted receipts from family completion.
- Why this default: Phase 4 separates `Promotion 领取不了` from `Promotion 条件咨询后仍无法参加`. Ambiguous wording is weak acceptance evidence. Stable contradiction phrasing is safer than forcing a family boundary the runtime does not currently hold.
- Evidence: Accepted counted flows: `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/promotion_condition_conflict_basic/summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/promotion_condition_conflict_cashback_qualified/summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/promotion_condition_conflict_reward_center_stuck/summary.json`. Excluded exploratory drifts: `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/promotion_condition_conflict_cashback_turnover/summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/promotion_condition_conflict_threshold_message/summary.json`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/build/pilot-lab` on draft `cmq4q82mx0001qj32gt8htfiq`. Accepted receipts were `scn_f5a86f66-b384-42bd-a99f-eafb230f3cb9`, `scn_f36263dd-d4b0-4ce8-aa89-7d879fd110b5`, and `scn_719e1f35-f34a-49a2-a442-f1368d34c67a`, all durable after refresh and reopen. Excluded exploratory receipts `scn_0bc5dd6e-6f97-4c09-99d5-d221f9bd2cbd` and `scn_bb9064d9-341e-4de4-a485-5432122c3783` routed to `promotion_claim_failed`.
- Owner decision needed: None for continuing acceptance. If product later wants phrases like `系统提示条件不满足` to live under `promotion_condition_conflict`, confirm whether to retune routing or keep those phrases under `promotion_claim_failed`.
- Next recommended step: For counted `promotion_condition_conflict` evidence, keep using direct contradiction phrasing around already-met conditions plus `还是参加不了`. Treat `不能领取 / 条件不满足` wording as `promotion_claim_failed` unless runtime routing is intentionally retuned.
- Follow-up owner: owner / product / delivery lead

### 2026-06-11 - J1B Scenario Matrix Uses Mocked Playground Operational Tool Execution

- Area: J1B production acceptance / tool execution scope
- Status: fixed
- Severity: P1
- Uncertainty: Historical only. The final counted J1B scenario matrix on `https://demo.anytrans.ai/build/pilot-lab` is production `agentRuntime` validation, and every accepted Playground receipt in the final index recorded `toolExecutionMode=mocked`. That matrix alone therefore could not prove live HTTP execution.
- Default action taken: Kept the counted J1B matrix explicitly mocked, then closed the remaining gap with a separate production tool-boundary receipt that proves safe read-only live HTTP execution while preserving truthful dry-run labeling for Playground.
- Why this default: The architect required mocked-vs-real truth to stay separate. The safe closure is to prove live read-only execution in production and keep unsafe side effects gated, rather than pretending the mocked Playground matrix was live.
- Evidence: `.artifacts/delivery-audit/2026-06-11/tool-execution-boundary/summary.md`; `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/final-j1b-acceptance-index.md`; `.artifacts/delivery-audit/2026-06-11/production-j1b-member-id-routing/summary.md`; `.artifacts/delivery-audit/2026-06-11/livechat-chain/webhook-stability-after-publish/summary.md`
- Production URL / screenshot / receipt: The tool-boundary receipt records production live `get_latest_deposit` output through the stable external J1B webhook, additional live read-only outputs (`get_latest_withdrawal`, `get_withdraw_conditions`, `get_transaction_history`, `get_account_status`) from the matched production LiveChat case, and the still-mocked `toolExecutionMode=mocked` Playground boundary for counted J1B receipts.
- Owner decision needed: None. The boundary is now explicit: safe read-only live execution works, and unsafe side effects remain honestly gated.
- Follow-up owner: owner / delivery lead / coding-team lead

### 2026-06-11 - J1B Long-Session Refresh/Reopen Restore Drops One Persisted Turn

- Area: Playground / long-session stability / trace restore
- Status: fixed
- Severity: P0
- Uncertainty: Historical only. The qualifying J1B long-session fallback run reached `30` customer messages, `30` assistant responses, and `331` backend traces, but the first refreshed/reopened Playground UI restore only showed `TRACE 29 persisted turns`.
- Default action taken: Treated the gap as a production blocker, replaced timestamp-based restore grouping with trace turn-start grouping, added focused regression coverage, deployed the fix, and reran only the long-session restore gate against the same persisted production chat.
- Why this default: The dispatch stop condition requires the long session to survive refresh/reopen without context loss or state loss. Backend persistence alone was not enough until the restored production UI also matched the persisted timeline.
- Evidence: Historical fail artifacts remain: `.artifacts/delivery-audit/2026-06-11/j1b-long-session/receipt.md`; `.artifacts/delivery-audit/2026-06-11/j1b-long-session/summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-long-session/session-readback-final.json`; `.artifacts/delivery-audit/2026-06-11/j1b-long-session/playground-long-session-final-desktop.png`; `.artifacts/delivery-audit/2026-06-11/j1b-long-session/playground-long-session-reopen-desktop.png`. Current pass artifacts: `.artifacts/delivery-audit/2026-06-11/j1b-long-session-post-fix/summary.md`; `.artifacts/delivery-audit/2026-06-11/j1b-long-session-post-fix/summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-long-session-post-fix/session-readback-detail.json`; `.artifacts/delivery-audit/2026-06-11/j1b-long-session-post-fix/playground-long-session-post-fix-initial.png`; `.artifacts/delivery-audit/2026-06-11/j1b-long-session-post-fix/playground-long-session-post-fix-refresh.png`; `.artifacts/delivery-audit/2026-06-11/j1b-long-session-post-fix/playground-long-session-post-fix-reopen.png`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/build/pilot-lab?tab=playground` on chat `pg_cmq4q82mx0001qj32gt8htfiq_1781158785107_4tvosv`. Historical screenshots showed `TRACE 29 persisted turns`. After local main commit `d76e812fef715fe5a4cf5298378c98705386a95c` was deployed on `deploy/main` as `68e7579c`, the post-fix production recheck showed `TRACE 30 persisted turns` on initial restore, refresh, and reopen while the same chat still read back as `30 / 30` messages and `331` traces.
- Owner decision needed: None.
- Next recommended step: Keep the long-session restore helper regression-covered and re-open this blocker immediately if a later deploy/restart causes persisted-turn loss again.
- Follow-up owner: coding-team lead / delivery lead

### 2026-06-10 - LiveChat Console Joint Configuration Timing

- Area: LiveChat / Integrations
- Status: fixed
- Severity: P1
- Uncertainty: Historical only. Full LiveChat console-side configuration originally risked slipping to a later joint session, which would have left the production webhook/app boundary under-proven.
- Default action taken: Kept Intera-side LiveChat readiness mandatory and then used the joint production setup window to prove the external LiveChat app was pointed at the stable J1B webhook URL while ingress, `/api/messages` routing, response mapping, and handoff traceability were exercised on production.
- Why this default: It closed the channel boundary with real production traffic instead of leaving the console-side configuration as a future assumption.
- Evidence: `.artifacts/delivery-audit/2026-06-11/livechat-chain/webhook-stability-after-publish/summary.md`; `.artifacts/delivery-audit/2026-06-11/livechat-chain/handoff-trace-closure/summary.md`
- Production URL / screenshot / receipt: The externally configured J1B webhook path remained `https://demo.anytrans.ai/api/livechat/webhook/default/cmq4mvv5o0001qj5yfl84kfl0` across publish and subsequent deploys; the stability receipt and handoff-trace closure receipt record the production proof with secrets redacted.
- Owner decision needed: None for timing. Future transfer-group or channel-copy tuning can be handled as ordinary LiveChat product work without reopening webhook identity.
- Follow-up owner: delivery lead / owner

### 2026-06-10 - Pilot Must Be Built Before Full Pilot Acceptance

- Area: Pilot Lab / ConfigPilot
- Status: fixed
- Severity: P0
- Uncertainty: Historical only. On 2026-06-10 the Pilot cockpit was still under construction, so broader Pilot acceptance would have been premature.
- Default action taken: Moved Pilot Commercial Readiness Gate A-D ahead of signoff, then closed that lane with authenticated production proof plus a post-redeploy receipt-persistence recheck.
- Why this default: It prevented false acceptance before the cockpit existed, while still allowing Pilot to become fully evidenced once the production Gate A-D flow and persistence repair were complete.
- Evidence: `.artifacts/delivery-audit/2026-06-11/production-authenticated-acceptance/scenario-store-persistence-summary.md`; `.artifacts/delivery-audit/2026-06-11/production-authenticated-acceptance/playwright-production-acceptance-summary.json`; `.artifacts/delivery-audit/2026-06-11/production-authenticated-acceptance/scenario-store-persistence-baseline-v2/playwright-production-acceptance-summary.json`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/build/pilot-lab` now has authenticated Gate A-D production proof with desktop/mobile screenshots, proposal apply proof, validation/propose-fix proof, release handoff generation proof, and post-redeploy scenario receipt persistence proof.
- Owner decision needed: None for Pilot construction gating. Future scope changes can be handled as ordinary Pilot product work.
- Follow-up owner: architect / coding-team lead

### 2026-06-10 - Local Smoke `networkidle` Timeout On Pilot Lab

- Area: Local browser smoke / Pilot Lab
- Status: fixed
- Severity: P1
- Uncertainty: `npm run smoke:console` timed out twice on the mobile `/build/pilot-lab` pass while waiting for Playwright `networkidle`, even though the route returned HTTP 200 and a targeted desktop/mobile Playwright check using `domcontentloaded` passed with no console/page errors or overflow.
- Default action taken: Tuned `scripts/smoke-console-auth.mjs` to use `domcontentloaded` plus route-specific visible readiness markers for hydrated Next dev pages and detail routes; increased navigation timeout to 60s for cold local compile.
- Why this default: Dev-mode `networkidle` was an unreliable readiness signal for Pilot Lab and Release/Operate hydrated pages. Visible route markers provide more truthful UI readiness while still preserving screenshot, redirect, console-error, page-error, and overflow checks.
- Evidence: `.artifacts/delivery-audit/2026-06-10/phase-1-pilot-gate-c/summary.md`; `.artifacts/delivery-audit/2026-06-10/phase-1-pilot-gate-d/summary.md`; `.artifacts/final-smoke/summary.json`; screenshots `browser-pilot-gate-c-desktop.png`, `browser-pilot-gate-c-mobile.png`, `browser-pilot-gate-d-desktop.png`, and `browser-pilot-gate-d-mobile.png`.
- Production URL / screenshot / receipt: Historical local smoke fixed. Production route-shell proof is now closed in `.artifacts/delivery-audit/2026-06-11/customer-ready-unified/platform-smoke-rerun/summary.md`, and the UI/reference rework production proof is recorded in `.artifacts/delivery-audit/2026-06-11/customer-ready-unified/ui-reference-rework/summary.md`.
- Owner decision needed: None for local smoke harness. Future production acceptance should continue using settled route markers instead of raw `networkidle`.
- Follow-up owner: coding-team lead

### 2026-06-10 - J1B Production Test Data And Tool Seeding

- Area: Playground / Tools / Procedure / LiveChat readiness
- Status: fixed
- Severity: P0
- Uncertainty: Production J1B Agent must have the previously working J1B business Tools and valid test member ids before realistic Playground validation.
- Default action taken: Seed or import Tools from `doc/tools-real/business-tools-backup.ts` into the production J1B Agent before J1B Playground acceptance. Use `doc/测试用户ID.md` for test member ids. Do not paste sensitive values into receipts.
- Why this default: The J1B Playground tests are only meaningful if the Agent can ask for member id, call the matching HTTP Tools, and answer from real tool evidence.
- Evidence: `.artifacts/delivery-audit/2026-06-11/production-j1b-member-id-routing/summary.md`; `.artifacts/delivery-audit/2026-06-11/j1b-production-ui/create-procedure-ui-summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-production-ui/withdrawal-not-credited/create-procedure-ui-summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-production-seed/seed-summary.json`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/build/pilot-lab` on draft `cmq4q82mx0001qj32gt8htfiq` (`J1B v3 draft`) now has the required business tools, manually created Procedure types, and the 12-scenario J1B seed baseline available for runtime validation.
- Historical note: This item records production setup readiness only. The final counted J1B Playground receipts on 2026-06-11 still reported `toolExecutionMode=mocked`; see the separate scope-gap item above for the current acceptance boundary.
- Owner decision needed: None for tool/procedure seeding. Historical follow-up complete: the full J1B 12-scenario matrix is now indexed in `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/final-j1b-acceptance-index.md`.
- Follow-up owner: delivery lead / coding-team lead

### 2026-06-12 - CONS-R1 Release Lifecycle Uses Integer Auto-Increment Versions

- Area: Release / agent version lifecycle
- Status: fixed
- Severity: P2
- Uncertainty: R1a needs a stable candidate-vs-historical rule before any broader lifecycle redesign. Current product/runtime semantics still use integer `version` rows per `(orgId, name)` family and `parentId` lineage. There is no separate release token, timestamp rank, or schema-side candidate marker.
- Default action taken: Keep the existing integer auto-increment version scheme for R1a. Classify a non-live row as the editable candidate only when it is directly forked from the current live row (`parentId === live.id`) or its integer `version` is newer than the live row. Treat all other non-live rows as historical. Do not add schema fields or Phase R1b semantics in this lane.
- Why this default: It fixes the concrete Release misclassification bug on the current production schema without widening into a migration lane or introducing ambiguous mixed version semantics mid-goal.
- Evidence: Lane contract `doc/handoffs/LANE_CONS_R1_RELEASE_VERSION_LIFECYCLE.md` Phase R1a; local gates and production proof recorded under `.artifacts/delivery-audit/2026-06-12/cons-r1a/**`.
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/build/release` on deployed commit `33eb4a99`. Proof: `production-release-r1a-initial.png`, `production-release-r1a-historical-selected.png`, `production-release-r1a-summary.json`, and `summary.md` under `.artifacts/delivery-audit/2026-06-12/cons-r1a/`.
- Owner decision needed: Tomorrow review can still choose a richer lifecycle marker in a later lane, but R1a is accepted on the current integer auto-increment default.
- Follow-up owner: architect / release lane owner

### 2026-06-12 - Deploy Build Emits Next Traced-Files Copy Warning But Health And Release Proof Stay Green

- Area: Deploy pipeline / Next standalone tracing
- Status: open
- Severity: P2
- Uncertainty: The `git push deploy HEAD:main` run for commit `33eb4a99` completed successfully and health returned `{"status":"ok","db":"connected"}`, but the host build emitted one warning while copying traced files for `/api/admin/agent-configs/[id]/activate`: `ENOENT ... login.html` under `.next/standalone/.../login.html`.
- Default action taken: Accepted the deploy because build, restart, health check, and the full `CONS-R1` production Release proof all passed afterward on `https://demo.anytrans.ai/build/release`. Logged the warning for follow-up instead of widening the lane into a deploy-pipeline investigation.
- Why this default: The warning did not block the deployed app or this lane's acceptance, but it touches host build hygiene and could hide a future standalone packaging regression if ignored.
- Evidence: deploy push log for `33eb4a99`; `.artifacts/delivery-audit/2026-06-12/cons-r1a/production-release-r1a-summary.json`; `.artifacts/delivery-audit/2026-06-12/cons-r1a/summary.md`.
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/build/release` remained healthy and accepted immediately after the warning. Lane proof is recorded in `.artifacts/delivery-audit/2026-06-12/cons-r1a/`.
- Owner decision needed: Decide whether to open a dedicated deploy/standalone tracing repair lane, or leave this as monitor-only unless the warning becomes user-visible or blocks a future deploy.
- Follow-up owner: architect / release lane owner

### 2026-06-15 - CONS-M1 Local Migration Dry-Run Needed Explicit Safe DSN, Not Ambient Env

- Area: CONS-M1 / Procedure migration verification
- Status: fixed
- Severity: P2
- Uncertainty: This checkout has no checked-in local env files (`.env.local`, `packages/shared/.env`, `apps/console/.env.local`, `apps/console/.env.test.local`), and an earlier turn risked overstating that as a hard `DATABASE_URL` blocker for the Procedure v1→v2 migration dry-run.
- Default action taken: Re-ran the migration script with an explicit safe local DSN instead of ambient shell config: `DATABASE_URL='postgresql://intera:intera@localhost:5434/intera' node scripts/migrate-procedures-v1-to-v2.mjs --dry-run`. The command passed and refreshed the lane artifact.
- Why this default: It converts an environment-assumption blocker into auditable proof while still respecting the repo rule that DB-touching verification must target the safe local Postgres listener on `localhost:5434`, not any production tunnel.
- Evidence: `docker-compose.yml`; `.artifacts/delivery-audit/2026-06-12/cons-m1/migration-dry-run.json`; `.artifacts/delivery-audit/2026-06-12/cons-m1/progress-summary.md`
- Production URL / screenshot / receipt: Not applicable. This closes a local verification ambiguity only; the remaining M1 blockers are still snapshot-proof, bundled J1B rerun, and one production v2 Procedure receipt on `https://demo.anytrans.ai`.
- Owner decision needed: None. Future DB-touching M1 verification in this checkout should continue using an explicit safe local DSN unless a controlled env harness is added.
- Follow-up owner: CONS-M1 lane owner / architect

### 2026-06-15 - CONS-M1 Still Carries `procedureDefinition*` Naming Aliases In Contract/Editor Surfaces

- Area: CONS-M1 / Procedure contract naming cleanup
- Status: fixed
- Severity: P3
- Uncertainty: After the v2-only runtime cleanup, the shared contract/editor/import surfaces still used `procedureDefinitionSchema`, `ProcedureDefinitionContract`, `parseProcedureDefinition`, `simulateProcedureDefinition`, and `ProcedureDefinition` naming even though they no longer represented a separate definition/compatibility layer.
- Default action taken: Removed the active-code naming aliases and renamed the public helpers/call sites to canonical Procedure names (`parseProcedure`, `simulateProcedure`, `ProcedureV2`, `procedureV2Schema`, `buildProcedurePrompt`, `toProcedure`, `buildNewProcedure`).
- Why this default: With the v1 dual track already removed, continuing to ship the old alias vocabulary would have left a false second center in the public/runtime/editor mental model for no product value.
- Evidence: `packages/shared/contracts/procedures.ts`; `packages/shared/contracts/case-types.ts`; `packages/shared/contracts/agent-template.ts`; `packages/shared/types/index.ts`; `apps/console/app/build/components/procedures/**`; `apps/console/lib/agent/procedure-executor.ts`; `apps/console/lib/agent/session-store.ts`
- Production URL / screenshot / receipt: Not applicable. This closes a naming-consistency cleanup inside the active code path; external M1 blockers are still prod-snapshot migration proof, bundled J1B rerun, and one production v2 Procedure receipt on `https://demo.anytrans.ai`.
- Owner decision needed: None. If any downstream package still wants the older label in docs, that is now an archive/docs-only decision, not an active-code compatibility requirement.
- Follow-up owner: none

### 2026-06-15 - CONS-M1 Safe Local Postgres Still Had One Legacy Stored Procedure, And The Real Apply Path Migrated It Cleanly

- Area: CONS-M1 / Procedure migration data-plane proof
- Status: fixed
- Severity: P2
- Uncertainty: The earlier M1 note only proved a dry-run on the safe local DSN. It did not yet prove that the checked-in migration script could mutate a real stored Procedure row and leave it re-readable as v2.
- Default action taken: Queried the safe local Postgres copy on `localhost:5434`, captured the stored CaseType procedure row before apply, ran the migration script for real, captured the row again after apply, and then reran the dry-run to confirm idempotence.
- Why this default: It upgrades the local proof from "script would migrate one row" to "script did migrate one real stored row and the persisted result re-parsed as v2," while still staying on the owner-approved safe local DSN rather than any production tunnel or snapshot.
- Evidence: `.artifacts/delivery-audit/2026-06-12/cons-m1/local-db-procedure-before.json`; `.artifacts/delivery-audit/2026-06-12/cons-m1/migration-apply-local.json`; `.artifacts/delivery-audit/2026-06-12/cons-m1/local-db-procedure-after.json`; `.artifacts/delivery-audit/2026-06-12/cons-m1/migration-dry-run-after-apply.json`
- Production URL / screenshot / receipt: Not applicable. This closes a local data-plane gap only. The remaining M1 blockers are still the prod-snapshot migration proof, the bundled J1B matrix rerun, and one production v2 Procedure receipt on `https://demo.anytrans.ai`.
- Owner decision needed: None. The next escalation point is not local mutation correctness anymore; it is whether a production-snapshot copy can be staged for the required snapshot-level verification.
- Follow-up owner: CONS-M1 lane owner / architect

### 2026-06-15 - CONS-M1 Runtime-v1 Migration Was Over-Promoting `create_human_task` From `allowedTools` Into Hard Actions

- Area: CONS-M1 / Procedure migration semantics
- Status: fixed
- Severity: P1
- Uncertainty: The intermediate `version: 1` runtime shape uses `allowedTools` as the tool capability set for a step. The first migration pass treated every listed tool as a top-level v2 action, which incorrectly turned `create_human_task` into an unconditional `request_human_handoff` action on investigative/finalization steps even when it was only a safe fallback capability.
- Default action taken: Tightened `scripts/migrate-procedures-v1-to-v2.mjs` so ordinary tools still map into primary actions, but `create_human_task` now migrates into a conditional `llm_eval` handoff branch (or a direct action only when it was the only actionable tool in the step). Then restored the safe local `deposit_issue` row back to its embedded `legacy.procedureV1`, reran the migration for real, and refreshed the apply artifacts.
- Why this default: It preserves the original semantics of runtime-v1 `allowedTools` as "available tools for this step" instead of silently rewriting the playbook into "every listed tool is a primary required action," which would have made migrated procedures more escalation-heavy than the source runtime intended.
- Evidence: `scripts/migrate-procedures-v1-to-v2.mjs`; `scripts/migrate-procedures-v1-to-v2.test.ts`; `.artifacts/delivery-audit/2026-06-12/cons-m1/local-db-procedure-after.json`
- Production URL / screenshot / receipt: Not applicable. This is a local migration-correctness fix; the remaining M1 acceptance blockers are still prod-snapshot migration proof, bundled J1B rerun, and one production v2 Procedure receipt on `https://demo.anytrans.ai`.
- Owner decision needed: None. The migration default is now the stricter and safer interpretation unless owner review later prefers a more explicit generated branch prompt vocabulary.
- Follow-up owner: CONS-M1 lane owner / architect

### 2026-06-15 - CONS-M1 Production Probe Shows V2 Editor Live But Repeats Already-Submitted Deposit Facts

- Area: CONS-M1 / production Procedure proof / fact carry-forward
- Status: fixed
- Severity: P0
- Uncertainty: The first authenticated production probe on `https://demo.anytrans.ai` proved that `/build/components/procedures/deposit_not_credited` was already rendering the live v2 editor surface (`Procedure v2 编排`, `6` steps, `2` branches), and `/build/pilot-lab?tab=playground` in `Runtime` mode did start `deposit_not_credited`. However, that initial run did not carry structured form inputs forward reliably: after submitting `member_id = JAYA113C88F`, the assistant later asked for `会员ID` again; after additional `amount`, `payment_channel`, and `transfer_time` submissions, the run still returned to asking for `会员ID` and `存款时间` instead of progressing to the evidence/tool step.
- Default action taken: Treated the first probe as a real production blocker rather than "missing proof". Captured the live editor screenshot plus looping-runtime receipts under `.artifacts/delivery-audit/2026-06-15/cons-m1-production-probe/`, landed the structured `formResult` submit/run hotfix, and traced the deeper continuity bug: after `start_procedure`, Playground was still restoring sessions via `chatId + type='playground'`, so once the runtime rewrote `Case.type` to `deposit_not_credited` every follow-up turn silently minted a fresh backend case while the UI kept posting the stale `chatId`. The fix now keys Playground continuity on `chatId + orgId + userId`, updates session list/detail/delete routes to the same contract, and lets the frontend accept a newly minted `session_init.chatId` when the backend rotates it. After deploy, reran production twice: a direct partial-form API replay still shows that `/api/admin/playground/run` will accept incomplete `formResult` payloads without UI required-field enforcement, but the UI-faithful rerun using the actual 4-field required form advanced beyond collection, executed `get_latest_deposit` + `get_transaction_history`, and restored cleanly in the Pilot Lab UI.
- Why this default: It preserves the honest failure evidence from the first probe, closes the real customer-visible continuity blocker with a realistic production rerun, and records the remaining partial-form behavior as a narrower robustness note instead of overstating it as an active production loop.
- Evidence: historical fail: `.artifacts/delivery-audit/2026-06-15/cons-m1-production-probe/summary.md`, `.artifacts/delivery-audit/2026-06-15/cons-m1-production-probe/production-procedure-v2-editor-deposit_not_credited.png`, `.artifacts/delivery-audit/2026-06-15/cons-m1-production-probe/pilot-lab-deposit-probe-duplicate-ask.png`, `.artifacts/delivery-audit/2026-06-15/cons-m1-production-probe/pilot-lab-deposit-probe-looping-collect-step.png`; local hotfix proof: `.artifacts/delivery-audit/2026-06-15/cons-m1-playground-formresult-hotfix-local/summary.md`; passing production rerun: `.artifacts/delivery-audit/2026-06-15/cons-m1-production-rerun-full-form/summary.json`, `.artifacts/delivery-audit/2026-06-15/cons-m1-production-rerun-full-form/summary.md`, `.artifacts/delivery-audit/2026-06-15/cons-m1-production-rerun-full-form/after.png`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/build/components/procedures/deposit_not_credited` showed the live v2 editor; `https://demo.anytrans.ai/build/pilot-lab?tab=playground` first reproduced the looping `collect_deposit_details` bug, and after deploy the same surface restored a passing runtime-backed rerun where the required 4-field form was submitted once, the run advanced into `get_latest_deposit` / `get_transaction_history`, and the restored UI showed the resolved account evidence instead of re-asking for facts.
- Owner decision needed: None for the continuity blocker itself. Remaining M1 blockers are now the prod-snapshot migration proof and the bundled Wave-2 J1B rerun. If product wants stricter server-side enforcement on incomplete `formResult` payloads, open that as a follow-up hardening item rather than reopening this resolved production continuity bug.
- Follow-up owner: CONS-M1 / runtime lane owner / architect

### 2026-06-15 - Scenario Receipts Were Collapsing Case `waiting_human` And Procedure Terminal Truth Into One `finalStatus`

- Area: Scenario Lab / Pilot receipts / Procedure acceptance semantics
- Status: fixed
- Severity: P2
- Uncertainty: After the 2026-06-15 owner decision ("successful human handoff on any channel finalizes the Procedure"), Scenario receipts still exposed only a single top-level `finalStatus`. In handoff cases that field continued to read `waiting_human`, which is still correct for the outer case/chat layer, but it no longer proved the Procedure terminal contract. That made runtime receipts easy to misread as "Procedure paused for human review" even when `ProcedureRun.status=completed`.
- Default action taken: Kept `finalStatus` as the outer case/chat status, then added explicit `procedureStatus` and `procedureOutcome` fields to the Scenario contract, runtime evidence builder, Pilot authoring surface, and receipt panel. Runtime receipts now surface both truths simultaneously: e.g. `finalStatus=waiting_human` together with `procedureStatus=completed` and `procedureOutcome=handed_off`.
- Why this default: Renaming or overloading `finalStatus` would have broken existing receipt meaning and made historical comparisons harder. Adding explicit Procedure terminal fields preserves backward compatibility while making the owner-approved handoff contract directly auditable.
- Evidence: `packages/shared/contracts/scenarios.ts`; `apps/console/lib/scenarios/runner.ts`; `apps/console/lib/scenarios/runtime-runner.ts`; `apps/console/components/scenario-receipts/scenario-receipt-panel.tsx`; `apps/console/app/build/pilot-lab/page.tsx`; focused tests across `foundation-reset-contract`, `scenario-runner`, `runtime-runner`, `procedure-v2-runtime-artifact`, `admin/scenarios`, `admin/pilot gate A`, and `pilot-lab/page`.
- Production URL / screenshot / receipt: Not applicable yet. This is a local receipt-contract clarification that will make the next production v2 Procedure receipt on `https://demo.anytrans.ai` materially clearer and harder to misread.
- Owner decision needed: None for the contract split itself. If product later wants a UI label change from "Final status" to "Case status", that is copy polish, not a semantic blocker.
- Follow-up owner: CONS-M1 / Pilot receipt surfaces / architect

### 2026-06-15 - Production Scenario Authoring Still Drops `procedureStatus` And `procedureOutcome` Expectations

- Area: CONS-M1 / production Scenario authoring / handoff acceptance semantics
- Status: default-applied
- Severity: P1
- Uncertainty: After the 2026-06-15 owner decision ("successful human handoff on any channel finalizes the Procedure"), the production Scenario update flow on `https://demo.anytrans.ai` still did not persist the new expectation fields `procedureStatus` and `procedureOutcome` during a live patch of J1B handoff scenarios. The same update did keep `humanTransfer=true` and `finalStatus=waiting_human`, so the authoring surface is still missing part of the stricter terminal-contract shape even though runtime receipts can already expose Procedure terminal truth.
- Default action taken: Updated the local tool/prompt/docs contract to the new handoff-finalizes rule, re-patched the production J1B Scenario set, and recorded the live readback showing that handoff scenarios still round-trip only `humanTransfer` plus `finalStatus`. Then added a local proof pass on the current branch: the `admin/scenarios` route test passes with `procedureStatus` / `procedureOutcome`, and a real temporary scenario-store write/update/read cycle preserves both fields in persisted JSON. For current reruns, treat runtime receipt evidence (`procedureRuns`, `procedureStatus`, `procedureOutcome`) as the source of truth for Procedure terminal validation instead of relying on production Scenario config round-trip alone.
- Why this default: It keeps the acceptance run moving without falsely claiming that the production authoring surface can yet encode the full handoff terminal contract, while also narrowing the uncertainty honestly: the current local code path is ready, so the remaining gap is deploy parity / old-server behavior rather than missing local implementation.
- Evidence: `.artifacts/delivery-audit/2026-06-15/cons-m1-wave2-j1b-bundle/scenario-patch-summary.json`; `.artifacts/delivery-audit/2026-06-15/cons-m1-wave2-j1b-bundle/duplicate_deposit_basic-patched.json`; `.artifacts/delivery-audit/2026-06-15/cons-m1-wave2-j1b-bundle/human_support_requested_basic-patched.json`; `.artifacts/delivery-audit/2026-06-15/cons-m1-scenario-terminal-proof-local/summary.md`; `.artifacts/delivery-audit/2026-06-15/cons-m1-scenario-terminal-proof-local/store-proof.json`; `.artifacts/delivery-audit/2026-06-15/cons-m1-scenario-terminal-proof-local/vitest-scenarios-route.json`; `.artifacts/delivery-audit/2026-06-15/cons-m1-scenario-terminal-proof-production-now/summary.md`; `.artifacts/delivery-audit/2026-06-15/cons-m1-scenario-terminal-proof-production-now/summary.json`; `packages/shared/contracts/scenarios.ts`; `apps/console/lib/scenarios/runner.ts`; `apps/console/app/api/admin/scenarios/[name]/route.ts`; `apps/console/lib/scenarios/store.ts`
- Production URL / screenshot / receipt: Production Scenario patch flow used the authenticated admin route on `https://demo.anytrans.ai/build/pilot-lab`; the original readback stored under `.artifacts/delivery-audit/2026-06-15/cons-m1-wave2-j1b-bundle/scenario-patch-summary.json` showed `finalStatus=waiting_human` persisted but no `procedureStatus` / `procedureOutcome` keys returned. A fresh authenticated recheck on 2026-06-15 08:37 CST against `human_support_requested_basic` produced the same result in `.artifacts/delivery-audit/2026-06-15/cons-m1-scenario-terminal-proof-production-now/summary.json`: before update, after `PUT`, and immediate reread all still omitted `procedureStatus` / `procedureOutcome`.
- Owner decision needed: Confirm whether M1 must deploy the updated Scenario contract/UI before final J1B bundle sign-off, or whether owner-reviewed runtime receipts are sufficient for this one acceptance wave while the production authoring surface catches up.
- Follow-up owner: CONS-M1 lane owner / architect / delivery lead

### 2026-06-15 - CONS-M1 Production Snapshot Migration Proof Is Now Closed, And It Shows J1B Still Persists Legacy Procedures

- Area: CONS-M1 / production data-plane proof / Procedure migration
- Status: fixed
- Severity: P1
- Uncertainty: The earlier M1 blocker required a real production-snapshot copy, not just a safe-local DB row or a synthetic fixture. Until that snapshot existed, it was still possible that the checked-in migration script only worked on the local sample row and not on the actual J1B production case-type set.
- Default action taken: Logged into `https://demo.anytrans.ai` with the approved test admin account, exported the live J1B case-type list from `/api/admin/case-types?agentConfigId=cmq4q82mx0001qj32gt8htfiq`, then ran `scripts/migrate-procedures-v1-to-v2.mjs` in the new snapshot-input mode against that exported JSON and emitted a migrated output copy. Finally, ran a second validator pass over the migrated copy to prove every row now normalizes as v2.
- Why this default: It closes the snapshot blocker honestly without mutating production rows, and it proves the migration script on a real production-derived dataset instead of a hand-built or safe-local substitute.
- Evidence: `scripts/migrate-procedures-v1-to-v2.mjs`; `scripts/migrate-procedures-v1-to-v2.test.ts`; `.artifacts/delivery-audit/2026-06-15/cons-m1-production-snapshot-proof/summary.md`; `.artifacts/delivery-audit/2026-06-15/cons-m1-production-snapshot-proof/case-types-production-snapshot.json`; `.artifacts/delivery-audit/2026-06-15/cons-m1-production-snapshot-proof/migration-summary.json`; `.artifacts/delivery-audit/2026-06-15/cons-m1-production-snapshot-proof/post-migration-validation.json`
- Production URL / screenshot / receipt: Authenticated export source was `https://demo.anytrans.ai/api/admin/case-types?agentConfigId=cmq4q82mx0001qj32gt8htfiq`. The exported snapshot contained `12` stored J1B CaseType procedures; migration result was `migrated=12`, `alreadyV2=0`, `invalid=0`, and the post-migration validator proved `12/12` rows parse as `status='v2'`.
- Owner decision needed: None for the snapshot blocker itself. The new production-truth implication is that J1B still persists legacy Procedure payloads on `demo.anytrans.ai` today, so deploy/data migration parity must still be addressed before anyone claims the live data plane is already v2-native.
- Follow-up owner: CONS-M1 lane owner / deploy owner

### 2026-06-15 - Refreshed Wave-2 J1B Production Bundle Still Fails 10 Of 36 Scenarios After Scenario Patching

- Area: CONS-M1 / production acceptance / J1B matrix rerun
- Status: open
- Severity: P1
- Uncertainty: After refreshing the stale Scenario expectations to the current runtime contract on production, it was still unknown whether the remaining M1 blocker was mostly "old expectations" or mostly "real runtime behavior gaps". The previous bundle receipt was stale enough that it could not answer that cleanly.
- Default action taken: Re-ran the production Scenario patch script into a fresh artifact folder, then ran the full 36-scenario J1B bundle again on `https://demo.anytrans.ai`. Preserved per-scenario receipts, the refreshed `summary.json`, and UI screenshots for both the pass-proof and fail-proof states.
- Why this default: It turns the broad blocker into a concrete current-state matrix with exact failing scenario names and failure reasons, so follow-up work can target runtime/taxonomy issues instead of reopening already-fixed Scenario expectation drift.
- Evidence: `.artifacts/delivery-audit/2026-06-15/cons-m1-wave2-j1b-bundle-refresh/scenario-patch-summary.json`; `.artifacts/delivery-audit/2026-06-15/cons-m1-wave2-j1b-bundle-refresh/summary.json`; `.artifacts/delivery-audit/2026-06-15/cons-m1-wave2-j1b-bundle-refresh/pilot-lab-bundle-pass-receipt.png`; `.artifacts/delivery-audit/2026-06-15/cons-m1-wave2-j1b-bundle-refresh/pilot-lab-bundle-failure.png`
- Production URL / screenshot / receipt: Production target remained `https://demo.anytrans.ai` on J1B draft `cmq4q82mx0001qj32gt8htfiq`. The refreshed bundle result is `26` pass / `10` fail. Current concrete failures are:
  - structured-collection/runtime mismatches: `withdrawal_not_credited_reference_first`, `duplicate_deposit_basic`, `promotion_claim_failed_member_first_followup_bonus`
  - direct-human / reset-path escalation mismatches: `human_support_requested_followup_member`, `human_support_requested_direct_detailed`, `login_password_reset_phone_changed`, `withdrawal_password_reset_phone_changed`
  - taxonomy / routing mismatches: `account_wallet_frozen_basic`, `account_wallet_frozen_followup_member`, `account_wallet_frozen_login_locked`
- Historical note: this rerun also reaffirmed the separate terminal-proof gap. Even when a handoff-shaped scenario passed, production receipts still exposed `procedureStatus=null` and `procedureOutcome=null`, so owner-approved handoff-finalizes proof still cannot be signed off on the currently deployed production receipt surface.
- Owner decision needed: None before the next engineering pass. The default next action is to treat the `10` failures as real current production acceptance failures, but not to over-attribute them yet: the same lane proved that all `12` production J1B case types are still stored in legacy Procedure form, so root-cause attribution remains split between legacy live data, runtime/prompt/taxonomy behavior, and the separate `procedureStatus/procedureOutcome` deploy-parity blocker.
- Follow-up owner: CONS-M1 lane owner / runtime owner / delivery lead

### 2026-06-15 - CONS-M1 Live J1B CaseType Rows Were Updated In Place To Procedure V2 And Revalidated 12/12

- Area: CONS-M1 / production data-plane parity / J1B case types
- Status: fixed
- Severity: P1
- Uncertainty: The earlier snapshot proof closed the migration-script correctness gap, but it also proved a more uncomfortable truth: all `12` live J1B CaseType rows on `https://demo.anytrans.ai` were still persisted in legacy Procedure form. Until those rows were updated or explicitly exempted, any remaining production failures could still be hand-waved away as "maybe the runtime is fine, maybe the live data plane is just stale."
- Default action taken: Applied the already-migrated v2 payloads back to the authenticated J1B CaseType admin API on `https://demo.anytrans.ai`, then ran a second final sequential readback validator over all `12` rows. The first parallel readback was timing-noisy and is preserved only as historical context; the authoritative proof is the final sequential validator.
- Why this default: It removes the biggest remaining data-plane ambiguity before further runtime debugging. After this point, follow-up scenario failures are no longer fairly attributable to "J1B is still running entirely on legacy stored procedures."
- Evidence: `.artifacts/delivery-audit/2026-06-15/cons-m1-production-v2-apply/summary.md`; `.artifacts/delivery-audit/2026-06-15/cons-m1-production-v2-apply/apply-summary.json`; `.artifacts/delivery-audit/2026-06-15/cons-m1-production-v2-apply/readback-after-apply-final.json`; `.artifacts/delivery-audit/2026-06-15/cons-m1-production-v2-apply/readback-validation-final.json`
- Production URL / screenshot / receipt: Authenticated writes targeted the J1B draft under `https://demo.anytrans.ai` with `agentConfigId=cmq4q82mx0001qj32gt8htfiq`. Final authoritative validation result: `12` checked, `0` bad.
- Owner decision needed: None. The live J1B case-type data plane is now v2-shaped; remaining blockers should be debugged as real runtime/receipt issues unless new contradictory evidence appears.
- Follow-up owner: CONS-M1 lane owner / runtime owner

### 2026-06-15 - Targeted Rerun After Live J1B V2 Apply Recovered 6 Of The 10 Failing Scenarios, Leaving 4 Narrower Runtime Gaps

- Area: CONS-M1 / production acceptance / targeted J1B rerun
- Status: open
- Severity: P1
- Uncertainty: Once the live J1B CaseType rows were actually updated to v2, it was still unclear whether the previous `10` failures would mostly disappear, partially recover, or remain unchanged. Without that rerun, the lane could not tell whether to focus next on data parity or on runtime logic.
- Default action taken: Re-ran only the `10` scenarios that had failed in the refreshed 36-scenario bundle, using the live J1B draft after the in-place v2 apply.
- Why this default: It provides a fast attribution split. If most failures recovered, the lane learns the live legacy data plane was a major factor. If a narrower residue remains, the next code pass can target concrete runtime behavior rather than broad migration uncertainty.
- Evidence: `.artifacts/delivery-audit/2026-06-15/cons-m1-wave2-j1b-targeted-after-v2-apply/summary.md`; `.artifacts/delivery-audit/2026-06-15/cons-m1-wave2-j1b-targeted-after-v2-apply/summary.json`
- Production URL / screenshot / receipt: Production target remained `https://demo.anytrans.ai` on J1B draft `cmq4q82mx0001qj32gt8htfiq`. Targeted rerun result: `6` recovered and `4` still failing. Recovered: `human_support_requested_followup_member`, `human_support_requested_direct_detailed`, `account_wallet_frozen_basic`, `account_wallet_frozen_followup_member`, `withdrawal_password_reset_phone_changed`, `promotion_claim_failed_member_first_followup_bonus`. Remaining failures: `withdrawal_not_credited_reference_first`, `duplicate_deposit_basic`, `account_wallet_frozen_login_locked`, `login_password_reset_phone_changed`.
- Owner decision needed: None before the next code pass. The lane should now treat those `4` failures as the live current blocker set.
- Follow-up owner: CONS-M1 lane owner / runtime owner

### 2026-06-15 - `start_procedure` Still Appears To Drop Same-Turn `collectedFacts` When A New ProcedureRun Starts

- Area: CONS-M1 / runtime continuity / Procedure start semantics
- Status: open
- Severity: P0
- Uncertainty: The narrowed set of `4` remaining production failures still shared a suspicious pattern: the triggering user message already contained useful structured evidence such as `member_id`, reference numbers, or an explicit request for human support; `start_procedure` was called from that same turn; yet the fresh ProcedureRun often asked for those facts again or failed to branch/handoff as if they had never been provided.
- Default action taken: Did not guess-fix in production. Instead, traced the targeted receipts and current owned runtime code to isolate the likely seam. The strongest signal is that `toolInput.collectedFacts` is present on the `start_procedure` call, but `handleStartProcedure()` does not reconcile that payload into the newly started run, and `startProcedureRun()` currently seeds raw input events without an explicit same-turn collected-fact ingest step.
- Why this default: It narrows the next engineering slice to a falsifiable runtime hypothesis instead of leaving the lane with a vague "some scenarios still fail" statement.
- Evidence: `.artifacts/delivery-audit/2026-06-15/cons-m1-wave2-j1b-targeted-after-v2-apply/account_wallet_frozen_login_locked.json`; `.artifacts/delivery-audit/2026-06-15/cons-m1-wave2-j1b-targeted-after-v2-apply/withdrawal_not_credited_reference_first.json`; `.artifacts/delivery-audit/2026-06-15/cons-m1-wave2-j1b-targeted-after-v2-apply/duplicate_deposit_basic.json`; `apps/console/lib/agent/tool-interceptor.ts`; `apps/console/lib/agent/session-store.ts`
- Production URL / screenshot / receipt: In `account_wallet_frozen_login_locked`, the `start_procedure` input carried `collectedFacts.member_id=JAYA113C88F` and `request_human_support=true`, but the run stayed on `collect_frozen_details` and never called `create_human_task`. In `withdrawal_not_credited_reference_first`, the trigger turn already carried `member_id` and reference text, but the run never advanced into `get_latest_withdrawal`.
- Owner decision needed: None before local implementation. Default next move is to add focused runtime tests for same-turn `collectedFacts` carry-forward and then patch the Procedure start path locally before another production rerun.
- Follow-up owner: CONS-M1 lane owner / runtime owner

### 2026-06-15 - Local Fix Landed For Same-Turn `collectedFacts` Carry-Forward, But Production Rerun Is Still Outstanding

- Area: CONS-M1 / runtime continuity / Procedure start semantics
- Status: default-applied
- Severity: P1
- Uncertainty: The lane's strongest remaining runtime hypothesis was that `start_procedure` did not ingest same-turn `collectedFacts`, and that pre-start runtime inputs were only copied into `run.inputs` instead of being replayed through the normal form-evidence / runtime-signal progression path.
- Default action taken: Landed a local fix that forwards `toolInput.collectedFacts` into `startProcedureRun(...)`, replays seeded input events through the same progression pipeline used by live input events, injects same-turn `collectedFacts` as structured runtime input on procedure start, raises `explicit_human_request` from `request_human_support=true`, matches `snake_case` / `camelCase` form-field aliases such as `member_id` and `memberId`, and treats migrated aggregate ask buckets like `*_details` as satisfied once structured detail answers arrive.
- Why this default: It directly addresses the concrete failure pattern seen in the remaining `4` production scenarios without reintroducing legacy `confirmedFacts` authority or a separate facts subsystem.
- Evidence: `apps/console/lib/agent/tool-interceptor.ts`; `apps/console/lib/agent/session-store.ts`; `apps/console/lib/agent/__tests__/unit/tool-interceptor.test.ts`; `apps/console/lib/agent/__tests__/unit/session-store.test.ts`; `.artifacts/delivery-audit/2026-06-15/cons-m1-collected-facts-local/summary.md`
- Production URL / screenshot / receipt: Not yet rerun on `https://demo.anytrans.ai`. Local verification passed: focused Vitest (`25` tests), `r3-runtime-protocol` (`7` tests), `tsc`, and `build:console`.
- Owner decision needed: None before the next rerun. Default next step is an authenticated production rerun of the remaining `4` scenarios to confirm whether this local fix closes them or exposes the next narrower blocker.
- Follow-up owner: CONS-M1 lane owner / runtime owner

### 2026-06-15 - Procedure Start Seam Renamed To `procedureInputs` While Preserving Legacy Nested-Record Compatibility

- Area: CONS-M1 / runtime vocabulary lock / Procedure start semantics
- Status: default-applied
- Severity: P2
- Uncertainty: After the local same-turn carry-forward fix landed, the owned M1 code still used the legacy internal field name `collectedFacts`, which contradicted the owner-approved v2 mental model (`inputs/evidence`, not facts-bag authority) and kept the Wave-2 grep gate semantically dirty even though behavior had improved.
- Default action taken: Renamed the owned runtime seam to canonical `procedureInputs` in `tool-interceptor` and `session-store`, updated the structured-input timeline wording, and kept a narrow compatibility path that absorbs a single extra nested record on `start_procedure` input so production traces that still send the old shape do not regress before the next rerun.
- Why this default: It moves the live M1 code closer to the approved v2 vocabulary without gambling on a hard compatibility break while the remaining `4` production scenarios are still awaiting rerun proof.
- Evidence: `apps/console/lib/agent/tool-interceptor.ts`; `apps/console/lib/agent/session-store.ts`; `apps/console/lib/agent/__tests__/unit/tool-interceptor.test.ts`; `apps/console/lib/agent/__tests__/unit/session-store.test.ts`; `.artifacts/delivery-audit/2026-06-12/cons-m1/progress-summary.md`
- Production URL / screenshot / receipt: Not yet rerun on `https://demo.anytrans.ai`. Local verification passed: focused Vitest (`3` files, `36` tests), `tsc`, `build:console`, and `git diff --check`.
- Owner decision needed: None before the next production rerun. If the remaining live failures persist, the lane should treat this rename as settled and keep focusing on scenario closure + receipt-surface parity.
- Follow-up owner: CONS-M1 lane owner / runtime owner
