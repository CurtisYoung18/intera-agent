# Post-Phase B Cleanup & Next Steps

**Created:** 2026-06-02 | **Branch:** `main` @ `6346c23`  
**Context:** Phase A (migration) + Phase B (UI) complete. Deployed to `demo.anytrans.ai`.

> Reference: [doc/handoffs/PROJECT_CONTEXT.md](../handoffs/PROJECT_CONTEXT.md)

---

## Immediate (code-level, no deployment needed)

### 1. Remove `agentConfigId` from ApiKey schema ✅
→ Done in `bd8bd9c`. Guide archived: `doc/what's done/2026-06-02-01-remove-agent-config-id.md`

### 2. Fix Prisma seed bug ✅
→ Done in `e77ddaf`. Guide archived: `doc/what's done/2026-06-02-02-fix-prisma-seed.md`

### 3. Fix docked-preview SWC bug ✅
→ Done in `654bde9`. Guide archived: `doc/what's done/2026-06-02-03-fix-docked-preview-swc.md`

### 4. Clean `doc/handoffs/` ✅
→ Old handoff renamed to `PROJECT_CONTEXT.md` (`2d55c2b`). Updated 2026-06-02: removed stale gotchas (agentConfigId, SWC bug), fixed test count (424).

---

## Server-side (requires SSH to demo.anytrans.ai)

### 5. Fill real LLM API keys ✅
→ Done 2026-06-02. MiniMax + DeepSeek + OpenRouter keys written to `/etc/intera/console.env`. 14 models live.

### 6. Rotate SSH credentials ⏭️ (deferred)
→ Skipped 2026-06-02. Password exposed — manual rotation when ready.

### 7. Connect LiveChat ✅
→ Done 2026-06-02. DB `livechat_configs` populated (org=`default`). 3 webhooks configured in LiveChat Developer Console pointing to `https://demo.anytrans.ai/api/livechat/webhook/default` (incoming_event, incoming_chat, app webhook). Secret: `1040244124`.

---

## Longer-term

### 8. Add GitHub deploy key to server ✅
→ Done 2026-06-02. SSH key generated, added to GitHub deploy keys (write access). Server git remote updated to `git@github.com:CurtisYoung18/intera-agent.git`. `git pull` confirmed working.

### 9. Delete `apps/chat` ✅
→ Done 2026-06-02. All routes+migrations complete, deployed to production.

### 10. Cert renewal strategy ✅ (documented)
→ Manual cert valid until 2026-07-22. Durable cron monitoring active.

---

## Phase C (future, not started)

### 11. Multi-agent per org + Multi-org user accounts
- **Spec:** [doc/plans/2026-06-01-multi-agent-multi-org-plan.md](../plans/2026-06-01-multi-agent-multi-org-plan.md)
- **Scope:** AgentConfig 1:N, User table, workspace switcher — deferred.

---

## Done (moved to doc/what's done/)

| Doc | Completed |
|---|---|
| `2026-06-01-combined-migration-and-ui-refactor.md` | Phase A migration + Phase B UI |
| `2026-06-01-deploy-ubuntu.md` | Ubuntu deployment to demo.anytrans.ai |
| `2026-06-01-workorder-local-validation-and-phase-b.md` | Local validation + Phase B work order |
| `2026-06-01-deploy-auth-checklist.md` | (previously archived) |
| `2026-06-01-chat-to-console-migration.md` | (previously archived) |
| `2026-06-01-case-agent-refactor.md` | (previously archived) |
| `2026-06-02-01-remove-agent-config-id.md` | agentConfigId YAGNI removal (`bd8bd9c`) |
| `2026-06-02-02-fix-prisma-seed.md` | Prisma seed fix (`e77ddaf`) |
| `2026-06-02-03-fix-docked-preview-swc.md` | docked-preview SWC fix (`654bde9`) |
| `apps/chat deletion` | All routes to console, deployed (`6346c23`) |
| `LLM API keys` | MiniMax + DeepSeek + OpenRouter on demo.anytrans.ai |
| `LiveChat DB config` | livechat_configs populated, webhooks configured |
| `GitHub deploy key` | `git pull` over SSH, no more bundle |
