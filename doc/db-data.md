# Intera DB — Current Data (Ubuntu self-hosted PostgreSQL)

Snapshot: 2026-06-04 | 26 tables | PostgreSQL

---

## organizations (3 rows)

| id | name | has_password |
|----|------|-------------|
| default | Test | false |
| demo | Demo | false |

> `api` org removed; recreated as `demo` (matching git history `9dc61bc`). `default` renamed to "Test".

---

## users (2 rows)

| id | email | name |
|----|-------|------|
| cmpzcj5ei000nqjb18ils6otp | test@intera.dev | Test User |
| owner-001 | magicyoung63@gmail.com | Curtis |

> `test@intera.dev` added since last snapshot.

---

## memberships (3 rows)

| user_id | org_id | role |
|---------|--------|------|
| cmpzcj5ei000nqjb18ils6otp | default | admin |
| owner-001 | default | owner |
| owner-001 | demo | owner |

> `owner-001` now has memberships in both `default` (Test) and `demo` (Demo). `test@intera.dev` is admin on `default`.

---

## agent_configs (3 rows)

| name | org | v | active | model | temp | maxIter |
|------|-----|---|--------|-------|------|---------|
| Agent 1 | default | 1 | true | claude-sonnet-4-20250514 | 0.5 | 20 |
| Default | default | 1 | true | claude-sonnet-4-20250514 | 0.5 | 20 |
| Default | demo | 1 | true | claude-sonnet-4-20250514 | 0.5 | 20 |

> 3 agents total (2 in `default`, 1 in `demo`). Existing rows still carry the old model string; new agents created after 2026-06-04 will use `deepseek-v4-flash` via `DEFAULT_MODEL`.

---

## policies (18 rows, 6 per org × 3 orgs, all enabled)

| org | name | hook |
|-----|------|------|
| api | conflict_requires_human | postTool |
| api | evidence_required_before_resolution | preFinalize |
| api | must_cite_basis | preFinalize |
| api | no_compensation_promise | preFinalize |
| api | investigate_before_escalation | preTool |
| api | no_high_risk_account_change | preTool |
| default | conflict_requires_human | postTool |
| default | evidence_required_before_resolution | preFinalize |
| default | must_cite_basis | preFinalize |
| default | no_compensation_promise | preFinalize |
| default | investigate_before_escalation | preTool |
| default | no_high_risk_account_change | preTool |
| demo | conflict_requires_human | postTool |
| demo | evidence_required_before_resolution | preFinalize |
| demo | must_cite_basis | preFinalize |
| demo | no_compensation_promise | preFinalize |
| demo | investigate_before_escalation | preTool |
| demo | no_high_risk_account_change | preTool |

> All 3 orgs have identical policy sets. `api` org still exists in policies table (has its own 6 rows).

---

## skills (18 rows, 9 per org × 2 orgs, all enabled, all `mode=mock`)

### default org

| name | toolCategory |
|------|--------------|
| dispatch_case_agent | operational |
| create_human_task | |
| finalize_case | |
| finalize_consultation | |
| finalize_sub_agent | |
| read_case_history | |
| request_user_input | |
| todo_read | |
| todo_write | |

### demo org

| name | toolCategory |
|------|--------------|
| dispatch_case_agent | operational |
| create_human_task | |
| finalize_case | |
| finalize_consultation | |
| finalize_sub_agent | |
| read_case_history | |
| request_user_input | |
| todo_read | |
| todo_write | |

> `demo` org now has its own 9 skills (was 0 in prior snapshot). Identical to `default`.

---

## case_types (18 rows, 6 per org × 3 orgs, all enabled)

| org | type | displayName |
|-----|------|-------------|
| api | account_issue | Account issue |
| api | deposit_issue | Deposit not credited |
| api | order_issue | Order issue |
| api | promotion_inquiry | Promotion inquiry |
| api | refund_request | Refund request |
| api | withdrawal_issue | Withdrawal issue |
| default | account_issue | Account issue |
| default | deposit_issue | Deposit not credited |
| default | order_issue | Order issue |
| default | promotion_inquiry | Promotion inquiry |
| default | refund_request | Refund request |
| default | withdrawal_issue | Withdrawal issue |
| demo | account_issue | Account issue |
| demo | deposit_issue | Deposit not credited |
| demo | order_issue | Order issue |
| demo | promotion_inquiry | Promotion inquiry |
| demo | refund_request | Refund request |
| demo | withdrawal_issue | Withdrawal issue |

---

## knowledge_sources (7 rows, all `default` org, all enabled)

| name | topK | embeddingRate |
|------|------|---------------|
| Deposit FAQ | 15 | 0.9 |
| Withdrawal FAQ | 15 | 0.9 |
| Account FAQ | 15 | 0.9 |
| Game FAQ | 15 | 0.9 |
| Promotion FAQ | 15 | 0.7 |
| General FAQ | 15 | 0.9 |
| Scenarios & SOP | 15 | 0.9 |

---

## api_keys (0 rows)

---

## invitations (2 rows)

| email | org | role | state |
|-------|-----|------|-------|
| magicyoung63@gmail.com | default | owner | accepted |
| test@intera.dev | default | viewer | accepted |

> `test@intera.dev` invitation added.

---

## channel_bindings (0 rows)

---

## channel_health (1 row)

| org | channel | status |
|-----|---------|--------|
| default | livechat | healthy |

---

## livechat_configs (1 row)

| org | licenseId | enabled |
|-----|-----------|---------|
| default | lyx987778734@gmail.com | true |

---

## cases (1 row)

| org | type | status | chatId |
|-----|------|--------|--------|
| default | general | created | TG01EC13YP |

---

## action_traces (8 rows)

Agent execution traces for the case above.

---

## messages (2 rows)

Chat messages for the case above.

---

## routings (4 rows)

Human task routing queues.

---

## webhook_events (4 rows)

LiveChat webhook delivery log.

---

## external_conversations (1 row)

Active LiveChat bridge conversation.

---

## empty tables

| Table | Note |
|-------|------|
| user_profiles | 0 rows |
| chat_memories | 0 rows |
| chat_sessions | 0 rows |
| human_tasks | 0 rows |
| audit_logs | 0 rows |
| livechat_pending_events | 0 rows |
