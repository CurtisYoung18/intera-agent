# Intera Harness — Project Progress

> Last updated: 2026-04-29
> Maps architecture spec to implementation status.

---

## Legend

- ✅ Complete
- 🔧 Functional but needs polish
- 🚧 In progress
- ⬜ Not started

---

## 1. Agent Core Engine

| Item | Spec § | Status | Notes |
|------|--------|--------|-------|
| Agent Loop (ReAct) | 二 | ✅ | Streaming tool exec, SSE events, terminate on human_task/finalize/maxIter |
| StreamingToolExecutor | 二 | ✅ | Parallel (safe) / serial (unsafe) tool execution during stream |
| Case Memory Manager | 三 | 🔧 | Heuristic fact extraction works. LLM-based keyEvent extraction not implemented. |
| 4-layer context compression | 三 | ⬜ | L1 truncation only. Autocompact/snip/microcompact not implemented. |
| Skill Router | 四 | ✅ | 8 built-in skills, mock/http dual mode, dynamic registry |
| Policy Engine | 五 | 🔧 | preTool deny_skills works. postTool conflict detection and preFinalize checks incomplete. |
| Trace Writer | 七 | ✅ | Writes to DB (was console.log) |
| Profiler | 二 | ⬜ | File not created |

## 2. Chat Frontend (Customer)

| Item | Route | Status | Notes |
|------|-------|--------|-------|
| Chat page | `/chat` | ✅ | Void + Fluid Glass design, Markdown, SSE streaming |
| Fluid background | — | ✅ | Canvas blobs + SVG grain + radial vignette |
| Water ripple | — | ✅ | Mouse-driven expanding rings on click/move |
| Light/dark theme | — | ✅ | CSS variables via data-theme, localStorage persist |
| Glass UI primitives | — | ✅ | GlassCard (4 variants), GlassInput, StatusPill, IconButton |
| Message bubble | — | ✅ | Markdown via react-markdown, tool badges, timestamps |
| Voice input bar | — | ✅ | Textarea auto-grow, Shift+Enter, IME-safe, bubble-float animation |
| CaseRail sidebar | — | ⬜ | Planned in P2 roadmap |
| Inline case trace | — | ⬜ | Planned in P2 roadmap |

## 3. Console (Operator)

| Item | Route | Status | Notes |
|------|-------|--------|-------|
| Human task list | `/ops/human-tasks` | ✅ | Glass cards, status dots, amber queue pills, FluidBackground |
| Human task detail | `/ops/human-tasks/[id]` | ✅ | Two-column layout, case summary + verdict form, vermillion resolve button |
| Task resolve API | `POST /api/human-tasks/[id]/resolve` | ✅ | Updates HumanTask + Case + writes ActionTrace |
| Admin console shell | `/admin` | ⬜ | Planned in P1 roadmap |
| Agent config page | `/admin/agent` | ⬜ | Planned in P1 roadmap |
| Skill registry page | `/admin/skills` | ⬜ | Planned in P1 roadmap |
| Policy rules page | `/admin/policies` | ⬜ | Planned in P1 roadmap |
| Case type config page | `/admin/case-types` | ⬜ | Planned in P1 roadmap |
| Routing config page | `/admin/routing` | ⬜ | Planned in P1 roadmap |
| Entry/user selector | `/` | ⬜ | Planned in P3 roadmap |

## 4. Data Layer

| Item | Status | Notes |
|------|--------|-------|
| Prisma schema (11 models) | ✅ | PostgreSQL-safe with @@map |
| Customer + AgentConfig | ✅ | Schema only, not loaded at runtime |
| Case + CaseMemory | ✅ | Schema + runtime write (create_human_task / finalize_case) |
| HumanTask | ✅ | Full CRUD: Chat creates, Console lists/detail/resolves |
| Message | ⬜ | Schema only. Messages not persisted (in-memory). |
| ActionTrace | ✅ | Written on human_task_created, human_task_resolved, final_resolution |
| Skill / Policy / Routing / CaseType | ⬜ | Schema only. P1 Admin pages will make these usable. |

## 5. API Routes

| Route | App | Status | Notes |
|-------|-----|--------|-------|
| `POST /api/messages` | Chat | ✅ | SSE streaming with MiniMax LLM |
| `GET /api/human-tasks` | Console | ✅ | Lists non-resolved tasks |
| `GET /api/human-tasks/[id]` | Console | ✅ | Task + Case + Memory + Traces |
| `POST /api/human-tasks/[id]/resolve` | Console | ✅ | Resolve + update Case + write Trace |
| `GET/PUT /api/admin/*` | Console | ⬜ | P1 — CRUD for AgentConfig, Skill, Policy, CaseType, Routing |

## 6. Cross-cutting

| Item | Status | Notes |
|------|--------|-------|
| Monorepo structure | ✅ | apps/chat, apps/console, packages/shared |
| Shared types | ✅ | packages/shared/types/index.ts |
| Shared Prisma | ✅ | Single SQLite, absolute path in .env.local per app |
| Shared UI primitives | ✅ | GlassCard, GlassInput, StatusPill, IconButton, ThemeToggle, FluidBackground |
| AI programming log | ✅ | .claude/logs/ |
| Dev rules | ✅ | .claude/rules/RULES.md |
| Design spec | ✅ | doc/spec/ |
| UI design spec | ✅ | doc/spec/2026-04-28-ui-design-spec.md |
| UI roadmap | ✅ | doc/ui-implementation-roadmap.md |

## 7. End-to-End Flows

| Flow | Status | Notes |
|------|--------|-------|
| Customer sends message → Agent responds | ✅ | SSE streaming, tool execution, markdown rendering |
| Agent creates human task → DB persisted | ✅ | Creates Customer/Case/CaseMemory/HumanTask/ActionTrace |
| Console shows pending task | ✅ | API reads from same SQLite |
| Human fills verdict → resolves | ✅ | Updates HumanTask + Case + writes Trace |
| Agent resumes after human resolution | ✅ | Console POSTs to Chat /api/messages with resumeTrigger |
| Form-based info collection | ✅ | request_user_input skill + FormCard UI + form_request SSE |
| Admin configures agent behavior | ⬜ | P1 — hardcoded DEFAULT_AGENT_CONFIG for now |

---

## 8. Claude Code Alignment Gaps

> Layers from CC's 10-layer defense-in-depth tool calling strategy.
> To be addressed in future iterations.

| # | CC Layer | Intera Status | Priority | Effort |
|---|----------|---------------|----------|--------|
| 1 | Strong prompt directives | ✅ "NEVER in text, use tool" + "# Using your tools" section | — | — |
| 2 | Zod schema validation | ✅ safeParse in tool executor, errors fed back to model | — | — |
| 3 | Deferred tool loading | ⬜ All skills sent at once. Future: shouldDefer + ToolSearch | P2 | M |
| 4 | Concurrency default false | ✅ create/finalize/request_user_input all false | — | — |
| 5 | Permission interlock | 🔧 preTool works. postTool/preFinalize incomplete | P1 | M |
| 6 | Result budgeting (50KB limit) | ⬜ No size cap on tool results | P2 | S |
| 7 | Error recovery (compact/fallback) | ⬜ No compaction or fallback model | P2 | L |
| 8 | Self-correcting error hints | 🔧 Zod errors include "correct and retry". Not for other errors. | P1 | S |
| 9 | Stop hooks | ⬜ No post-completion verification | P2 | M |
| 10 | Token budget nudge | ⬜ No token tracking | P3 | S |
| — | System prompt cache boundary | ⬜ No static/dynamic split for prompt caching | P3 | M |
| — | Tool description() per context | ⬜ Static descriptions only | P2 | S |
| — | Microcompact (tool result dedup) | ⬜ Not implemented | P2 | M |

---

## Summary

| Area | Done | Remaining |
|------|------|-----------|
| Agent Core Engine | 6/8 | Profiler, context compaction |
| Chat Frontend | 9/11 | CaseRail sidebar, inline trace |
| Console (Ops) | 3/3 | — |
| Console (Admin) | 0/5 | All P1 pages |
| Data Layer | 5/11 | Message persistence, Skill/Policy/CaseType/Routing CRUD, Customer config loading |
| API Routes | 4/9 | Admin CRUD endpoints |
| End-to-End Flows | 6/6 | — |
| CC Alignment | 2/12 | 10 remaining gaps (see §8) |
