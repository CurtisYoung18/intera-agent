# Codex Goal Dispatch - Production Pilot Delivery

**Last updated:** 2026-06-10
**Audience:** Codex Goal-mode agents, coordinator, owner review
**Purpose:** keep the Goal-mode prompt short while moving the full execution contract into docs.

---

## 0. How To Start A Goal-Mode Run

Use this short prompt in the Codex Goal input box:

```text
Goal: In /Users/curtis/Desktop/intera-agent, deliver Intera Agent Console to production-ready pilot quality by strictly following doc/handoffs/CODEX_GOAL_DISPATCH.md and all linked project docs. Treat docs as source of truth, build Pilot Lab before final Pilot acceptance, keep uncertainty log and receipts current, and accept only production proof from https://demo.anytrans.ai. Continue until fully documented complete or a true documented external blocker.
```

Do not paste the full delivery checklist into the Goal input box. The checklist below is the execution contract.

---

## 1. Source Of Truth

The Goal-mode agent must read and obey these docs before implementation:

1. [`MASTER_BUILD_HANDOFF.md`](./MASTER_BUILD_HANDOFF.md)
2. [`PLATFORM_DELIVERY_AUDIT_GOALS.md`](./PLATFORM_DELIVERY_AUDIT_GOALS.md)
3. [`CONSOLE_FINAL_REGRESSION_CHECKLIST.md`](./CONSOLE_FINAL_REGRESSION_CHECKLIST.md)
4. [`DELIVERY_UNCERTAINTY_LOG.md`](./DELIVERY_UNCERTAINTY_LOG.md)
5. [`../strategy/2026-06-10-pilot-commercial-readiness-proposal.md`](../strategy/2026-06-10-pilot-commercial-readiness-proposal.md)
6. [`../tools-real/business-tools-backup.ts`](../tools-real/business-tools-backup.ts)
7. [`../测试用户ID.md`](../测试用户ID.md)

Docs and checklists are mandatory. Do not skip, weaken, reinterpret, or shortcut acceptance criteria. If docs conflict or a decision is unclear, record the default action and owner-review question in `DELIVERY_UNCERTAINTY_LOG.md` before proceeding.

---

## 2. Non-Negotiable Acceptance Rules

- Final acceptance must be on `https://demo.anytrans.ai`; local tests are preflight only.
- Every page, subpage, tab, modal, drawer, detail page, action, state, CRUD path, import/export, publish, rollback, and test flow needs production verification.
- Every accepted user-facing flow needs screenshot or screen-recording proof.
- Every implementation/fix must be reliable, polished, user-friendly, visually acceptable, and first-customer ready.
- "Barely usable", rough UI, confusing UX, unclear errors, broken empty/loading/error states, flaky traces, or unreliable runtime behavior are failures.
- If testing reveals adjacent breakage, fix it in the same delivery loop or document the same delivery area as blocked.
- Do not expose secrets from `/Users/curtis/Desktop/live chat config backup.md`, `doc/tools-real/business-tools-backup.ts`, or `doc/测试用户ID.md`.

---

## 3. Execution Order

### Phase 0 - Orientation

- Read the source-of-truth docs.
- Inspect routes, tests, runtime surfaces, current dirty git state, and existing receipts.
- Do not revert unrelated user or parallel-agent work.
- Update `DELIVERY_UNCERTAINTY_LOG.md` for unclear defaults, missing credentials, blocked deploy paths, or owner decisions.

### Phase 1 - Pilot Lab Construction First

Build Pilot Lab before final Pilot acceptance. Follow Gate A-D from the Pilot commercial readiness proposal:

- Gate A: Schema / Contracts
- Gate B: Session / Planning
- Gate C: Proposal / Validation
- Gate D: UI / Self-Audit

Each Gate needs automated checks, manual checks, exit criteria, blockers, production proof, and a receipt.

### Phase 2 - Platform-Wide Audit

Audit Playground, Knowledge, Hooks, Procedures, Tools, Integrations, LiveChat, Settings, Build pages, Pilot Lab, nested pages, and all relevant compatibility routes.

Baseline assumption:

- Playground, Knowledge, and Hooks are only partially manually tested.
- Every other surface is unaccepted until production evidence proves it.

Test CRUD plus empty, loading, error, invalid input, partial config, permission/session, refresh, navigation, persistence, and responsive states. Fix and rerun until accepted.

### Phase 3 - J1B Production Setup

- Seed/import `doc/tools-real/business-tools-backup.ts` into the production J1B Agent/Draft.
- Use member IDs from `doc/测试用户ID.md`.
- The Agent must ask for `member_id` when needed, call the correct HTTP Tool, and answer from Tool/Procedure evidence.

### Phase 4 - J1B Playground Scenario Acceptance

Run all 12 P0 scenarios in production Playground:

1. 存款未到账
2. 重复存款
3. 存到旧订单
4. 取款未到账
5. 无法取款
6. Promotion 领取不了
7. Promotion 条件咨询后仍无法参加
8. 忘记登录密码
9. 忘记取款密码
10. 账号/钱包被冻结
11. App 下载/奖励未到账
12. 用户主动要求转人工

For every scenario, the Procedure must include:

- required facts
- ask/form steps
- Tool or static fixture reference
- transfer template
- 2-3 scenario examples

Each scenario needs at least 3 accepted production conversation flows with different wording and paths. At least one flow must cover edge or missing facts. At least one accepted flow must include targeted Intera Agent system-prompt tuning and rerun proof. Failed attempts do not count.

### Phase 5 - Long-Session Stability

Run at least one production Playground session that reaches memory auto-compact or 30 customer messages.

Acceptance requires:

- every customer message receives an Agent response
- no crash
- no state loss
- no Tool result corruption
- no stale answer duplication
- no ProcedureRun state leaking into business memory

Capture start, middle, end, trace, and memory/compact evidence where available.

### Phase 6 - Procedures, Hooks, Tools, LiveChat

- Procedures: full CRUD, step editing, Hook binding, runtime ProcedureRun proof, transfer behavior.
- Hooks: all scopes, trigger modes, blocked/allowed paths, failure states, trace proof.
- Tools: HTTP execution, failure handling, rich-message/render-hint output, Trace visibility.
- LiveChat: external console joint config may wait if blocked, but Intera-side config save/load, webhook to `/api/messages`, response mapping, and rich-message readiness must work.

Use `/Users/curtis/Desktop/live chat config backup.md` as reference only. Do not paste secrets.

### Phase 7 - Receipts

Every Gate or platform area needs a receipt with:

- production URL
- date/time
- account, Agent, and Draft/version
- actions and CRUD paths tested
- screenshots or recordings
- automated tests run
- production manual checks run
- bugs found
- fixes applied
- rerun proof
- residual risks
- accepted or blocked status

Maintain the final `Pilot Commercial Readiness Receipt`.

---

## 4. Strict Stop Conditions

Do not stop because the work is large, repetitive, slow, token-heavy, or because many bugs appear.

Do not stop after local success. Local success only allows production verification.

Do not stop after partial coverage. Every route, view, CRUD path, state, and runtime path must either pass production acceptance or be a documented hard blocker.

Do not accept a feature without screenshot/recording proof, trace/runtime proof where relevant, and rerun proof after fixes.

Do not downscope to "usable enough". If UI/UX, error recovery, runtime trace, persistence, or visual quality is rough, the feature is not accepted.

Do not ignore adjacent defects discovered during testing. Fix them or mark the same delivery area blocked.

Only mark complete when:

- every linked doc/checklist item is satisfied
- Pilot Gate A-D has receipts
- all required platform areas have production receipts
- all required screenshots/recordings and runtime proof exist
- relevant tests, typecheck, lint/build gates have passed or blockers are documented
- no unresolved P0/P1 blocker remains

Only mark blocked when an external dependency prevents safe progress after serious attempts. The blocker must include exact reproduction, evidence, attempted fixes, why no workaround is safe, required owner action, and next recommended step in `DELIVERY_UNCERTAINTY_LOG.md`.

If context or budget is low but work remains possible, write a precise continuation handoff and continue rather than claiming completion.
