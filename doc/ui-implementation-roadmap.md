# Intera Harness — UI Implementation Roadmap

> **Created:** 2026-04-28  
> **Status:** Draft, subject to team review  
> **Design Language:** Void + Fluid Glass（虚白 · 流光）

---

## Current State

| Page | Route | Status |
|------|-------|--------|
| Chat Frontend | `/chat` | ✅ Complete |
| Messages API (SSE) | `/api/messages` | ✅ Functional (MiniMax) |

---

## Implementation Order

### P0 — Ops: Human Task System

**Why first:** Agent can already call `create_human_task` and set Case to `waiting_human`.  
But there is no UI for a human operator to see, process, and resolve those tasks.  
This is the critical loop-closing piece.

| # | Page | Route | Core UI |
|---|------|-------|---------|
| 0.1 | Task Queue | `/ops/human-tasks` | Table of pending tasks: Case ID, queue, question preview, status, age. Click to open detail. |
| 0.2 | Task Detail | `/ops/human-tasks/[id]` | Left: Case summary (confirmedFacts, skillResults, keyEvents). Right: Agent's structured question + response form (verdict dropdown, expectedEta, notes, resolve button). Submit → POST `/api/human-tasks/[id]/resolve` → Agent resumes. |
| 0.3 | API Route | `/api/human-tasks` | GET list, GET by id, POST resolve |
| 0.4 | API Route | `/api/human-tasks/[id]/resolve` | POST — marks task resolved, triggers agent resume |

**Interaction flow:**
```
Agent detects need → create_human_task → Case = waiting_human
   → Human sees task in /ops/human-tasks
   → Opens detail, reviews evidence, fills verdict
   → Submits → Agent resumes → Case continues
```

### P1 — Admin: Agent Configuration

**Why second:** Currently all config is hardcoded in `DEFAULT_AGENT_CONFIG`.  
Admin pages let operators tune Agent behavior without touching code.

| # | Page | Route | Core UI |
|---|------|-------|---------|
| 1.1 | Admin Shell | `/admin` | 48px icon sidebar (glass) + top tab bar + content area. Redirects to `/admin/agent`. |
| 1.2 | Agent Config | `/admin/agent` | Model dropdown, Temperature slider, System Prompt textarea, maxIterations, thinkingBudget. Policy Hooks multi-select. Memory strategy subsection (L1 messages, L2 tokens, L4 cases). |
| 1.3 | Skill Registry | `/admin/skills` | List of Skill cards (name, mode badge, enabled toggle). Click → expand: inputSchema/outputSchema JSON editor, mockFixture editor, HTTP endpoint config, isConcurrencySafe toggle. Add new skill button. |
| 1.4 | Policy Rules | `/admin/policies` | List of Policy cards (name, hook point badge, enabled toggle). Click → expand: rule JSON editor with helper UI for deny_skills/deny_keywords/require_skills arrays. |
| 1.5 | Case Types | `/admin/case-types` | List of CaseType cards. Click → expand: type name, displayName, requiredFacts list editor, **stages drag-to-reorder list** (core feature — visual state machine builder). |
| 1.6 | Routing Config | `/admin/routing` | Queue list. Each: queue name, description, allowed skills multi-select, priority, autoAssign toggle. |
| 1.7 | API Routes | `/api/admin/*` | CRUD for all admin entities (AgentConfig, Skill, Policy, CaseType, Routing) |

### P2 — Chat: CaseRail + Trace

**Why third:** Enrich the chat experience with case context and operation history.

| # | Feature | Where | Core UI |
|---|---------|-------|---------|
| 2.1 | CaseRail sidebar | `/chat` (desktop) | Left slide-out panel (320px, glass). Lists current user's Cases. Each: type icon, status dot (color-coded), title, time. Active case highlighted. |
| 2.2 | Inline Trace | CaseRail card (expanded) | Click Case → card expands vertically to show operation timeline. Each entry: actionType icon + title + detail + timestamp. Chronological order. |
| 2.3 | Tool execution ring | MessageBubble | When toolUses present: animated conic-gradient ring on card border during executing, green dot on completed. |
| 2.4 | Case status transition | StatusPill | When case_status SSE event fires: badge color smoothly transitions (e.g., blue → yellow → green). 600ms gradient morph. |

### P3 — Entry & Session

| # | Page | Route | Core UI |
|---|------|-------|---------|
| 3.1 | User selector | `/` | Simple page: select user slot (u_try_1 ~ u_try_5), select customer (vendor_a etc.), enter → `/chat`. Sets cookies `try_uid` + `try_business`. |
| 3.2 | Session API | `/api/session` | POST — sets mock user + customer cookies |

---

## Design Notes

- **Admin/Ops pages** use the same Void color palette but with **faster animations** (150ms vs 400ms), **Sans-serif body text** (no serif), and **higher opacity glass** (0.7 vs 0.02). The feeling is "control room" vs "meditation room".
- **GlassCard variant `admin`** is already defined in `components/ui/glass-card.tsx`. Admin pages should use this variant for config panels.
- **JSON Editor** component: monospace font, dark bg, line numbers, syntax validation with red/green border feedback.

---

*End of roadmap.*
