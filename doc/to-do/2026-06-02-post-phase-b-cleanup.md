# Post-Phase B Cleanup & Next Steps

**Created:** 2026-06-02 | **Branch:** `main` @ `63ba1c8`  
**Context:** Phase A (migration) + Phase B (UI) complete. Deployed to `demo.anytrans.ai`.

> Reference: [doc/handoffs/HANDOFF_DEPLOY_PHASE_B_06_02.md](../handoffs/HANDOFF_DEPLOY_PHASE_B_06_02.md)

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

### 5. Fill real LLM API keys
- **File:** `/etc/intera/console.env` on server
- **Action:** Set `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL` (currently PLACEHOLDER).
- **Verify:** `curl https://demo.anytrans.ai/api/health` still 200, then test via Playground.

### 6. Rotate SSH credentials
- **Reason:** Password exposed in chat history.
- **Action:** `passwd` → `ssh-copy-id` → disable `PasswordAuthentication` + `PermitRootLogin` in sshd_config.

### 7. Connect LiveChat
- **File:** `/etc/intera/console.env`
- **Action:** Set `LIVECHAT_CLIENT_ID` + `LIVECHAT_CLIENT_SECRET`. Configure webhook URL in LiveChat Developer Console to `https://demo.anytrans.ai/api/livechat/webhook/<orgId>`.

---

## Longer-term

### 8. Add GitHub deploy key to server
- **Reason:** Currently using git-bundle + scp for deployment. Deploy key enables direct `git pull`.
- **Reference:** [deploy-ubuntu spec (now archived)](../what's%20done/2026-06-01-deploy-ubuntu.md) §3.

### 9. Delete `apps/chat`
- **Reason:** Kept as reference; safe to remove after live validation confirms console works independently.

### 10. Cert renewal strategy
- **Current:** Manual cert, expires 2026-07-22.
- **Options:** Tencent SSL console re-upload or switch to Let's Encrypt auto-TLS via Caddy.

---

## Phase C (future, not started)

### 11. Multi-agent per org + Multi-org user accounts
- **Spec:** [doc/to-do/2026-06-01-multi-agent-multi-org-plan.md](2026-06-01-multi-agent-multi-org-plan.md)
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
| `2026-06-02-01-remove-agent-config-id.md` | agentConfigId YAGNI removal |
| `2026-06-02-02-fix-prisma-seed.md` | Prisma seed fix |
| `2026-06-02-03-fix-docked-preview-swc.md` | docked-preview SWC fix |
