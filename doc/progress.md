# Intera Harness — Project Progress

> Last updated: 2026-04-30 (after Phase 1-5 Console Admin + Persistence)
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
| Agent Loop (ReAct) | 二 | ✅ | Streaming tool exec, SSE events, terminate on human_task/finalize/maxIter. `AgentLoop.create()` factory loads skills/policies from DB. |
| StreamingToolExecutor | 二 | ✅ | Parallel (safe) / serial (unsafe) tool execution during stream |
| Case Memory Manager | 三 | 🔧 | Heuristic fact extraction works. LLM-based keyEvent extraction not implemented. Summary persistence bug fixed (was lost between turns). |
| 4-layer context compression | 三 | ⬜ | L1 truncation only. Autocompact/snip/microcompact not implemented. |
| Skill Router | 四 | ✅ | 8 built-in skills + DB-loaded skills via `SkillRouter.create()`. mock/http dual mode. DB skills override built-ins by name. |
| Policy Engine | 五 | ✅ | Built-in policies + DB-loaded via `PolicyEngine.create()`. preTool/postTool/preFinalize hooks wired from DB. |
| Trace Writer | 七 | ✅ | All traces write to `action_traces` table (fire-and-forget). `llm_request_start`/`llm_response` track token usage + stop_reason. |
| Profiler | 二 | ⬜ | File not created |

## 2. Chat Frontend (Customer)

| Item | Route | Status | Notes |
|------|-------|--------|-------|
| Chat page | `/chat` | ✅ | Void + Fluid Glass design, Markdown, SSE streaming, event-driven human resolution via SSE |
| Fluid background | — | ✅ | Canvas blobs + SVG grain + radial vignette |
| Water ripple | — | ✅ | Mouse-driven expanding rings on click/move |
| Light/dark theme | — | ✅ | CSS variables via data-theme, localStorage persist, ThemeToggle in ChatShell |
| Glass UI primitives | — | ✅ | GlassCard (4 variants), GlassInput, StatusPill, IconButton, ThemeToggle |
| Message bubble | — | ✅ | Markdown via react-markdown, tool call badges (CC-style dot), form cards |
| Message list | — | ✅ | Scrollable, auto-scroll to bottom, RespondingBubble at bottom when loading |
| Voice input bar | — | ✅ | Always-unlocked, queue mode with pill indicator, dynamic placeholder, IME-safe |
| Responding bubble | — | ✅ | 3 staggered breathe dots + 15-phrase cycling verb pool, fades in/out below messages |
| Form card | — | ✅ | Inline floating glass card with flowing gradient border, file upload, validation |
| Thinking indicator | — | 🔧 | CC-style SVG loaders (dots/pulse/spin/scan). No longer used inside message bubbles — replaced by RespondingBubble. |
| Welcome message | — | ✅ | Serif branding + glass input placeholder |
| Case card | — | ✅ | Slides in from right, shows case status + facts + skills, real-time updates |
| CaseRail sidebar | — | ⬜ | Planned in P2 roadmap |
| Inline case trace | — | ⬜ | Planned in P2 roadmap |

## 3. Console (Operator + Admin)

| Item | Route | Status | Notes |
|------|-------|--------|-------|
| Human task list | `/ops/human-tasks` | ✅ | Glass cards, status dots, amber queue pills, FluidBackground |
| Human task detail | `/ops/human-tasks/[id]` | ✅ | Two-column layout, case context sidebar, consultation chat with agent (SSE), resolve/reopen/delete |
| Task resolve API | `POST /api/human-tasks/[id]/resolve` | ✅ | Updates HumanTask + Case + writes ActionTrace, await + retry (3x exponential backoff) with `notifyAgentResume()` |
| Task delete API | `DELETE /api/human-tasks/[id]/delete` | ✅ | Debug cleanup endpoint |
| Case detail + traces | `/ops/cases/[id]` | ✅ | Color-coded trace timeline (action types), token usage display, latency, expandable payloads, conversation viewer |
| Case memory editor | `/ops/cases/[id]/memory` | ✅ | Left: editable summary + facts + missing. Right: read-only skills + results + key events. Save → PUT API. |
| Case list API | `GET /api/cases` | ✅ | status filter, pagination |
| Chat API helper | `lib/chat-api.ts` | ✅ | Centralized URL helper, configurable via NEXT_PUBLIC_CHAT_API_URL env var |
| **Admin layout** | `/admin` | ✅ | Fixed sidebar nav (Agent/Skills/Policies/Case Types/Routing), glass-sidebar, FluidBackground |
| Agent config page | `/admin/agent` | ✅ | Model selector, temperature slider, system prompt editor, memory strategy JSON, policy hooks JSON |
| Skill registry page | `/admin/skills` | ✅ | Card list + create/edit modal, JSON editors for inputSchema/outputSchema, mock/http mode, enabled toggle |
| Policy rules page | `/admin/policies` | ✅ | Card list with hook badges (preTool/postTool/preFinalize), rule JSON editor, enabled toggle |
| Case type config page | `/admin/case-types` | ✅ | Card list showing state machines (stages → flow), JSON editors for stages/requiredFacts/escalateOn |
| Routing config page | `/admin/routing` | ✅ | Card list with skill badges + priority, JSON editor for skillsAllowed |
| Entry/user selector | `/` | ⬜ | Redirects to /ops/human-tasks for now |

## 4. Data Layer

| Item | Status | Notes |
|------|--------|-------|
| Prisma schema (11 models) | ✅ | PostgreSQL-safe with @@map |
| Customer + AgentConfig | ✅ | AgentConfig loaded at runtime with 30s TTL cache, fallback to DEFAULT |
| Case + CaseMemory | ✅ | Full CRUD, summary field now persisted correctly |
| HumanTask | ✅ | Full CRUD: Chat creates, Console lists/detail/resolves, in_progress tracking |
| Message | ✅ | Persisted after every agent loop (upsert per message). Console views via API. |
| ActionTrace | ✅ | All trace types written to DB (was MOCK/console-only). `llm_request_start`/`llm_response` track token usage. |
| Skill / Policy / Routing / CaseType | ✅ | All loaded from DB at runtime via `SkillRouter.create()` and `PolicyEngine.create()`. Built-ins as fallback. Admin CRUD pages ready. |

## 5. API Routes

| Route | App | Status | Notes |
|-------|-----|--------|-------|
| `POST /api/messages` | Chat | ✅ | SSE streaming, loads AgentConfig from DB, persists messages + memory, resumeTrigger flow |
| `POST /api/human-chat` | Chat | ✅ | Operator-agent consultation SSE, loads AgentConfig from DB, await+retry triggers customer update |
| `GET /api/cases` | Console | ✅ | List all cases, `?status=&limit=&offset=` |
| `GET /api/cases/[id]` | Console | ✅ | Case detail + memory + task count |
| `GET /api/cases/[id]/traces` | Console | ✅ | Trace timeline, `?actionType=&limit=&offset=` |
| `GET /api/cases/[id]/messages` | Console | ✅ | Conversation history, `?limit=&offset=` |
| `GET /api/cases/[id]/memory` | Console | ✅ | Read case memory |
| `PUT /api/cases/[id]/memory` | Console | ✅ | Edit confirmedFacts, missingFacts, summary (JSON validated) |
| `GET /api/human-tasks` | Console | ✅ | Lists non-resolved tasks |
| `GET /api/human-tasks/[id]` | Console | ✅ | Task + Case + Memory + Traces |
| `POST /api/human-tasks/[id]/resolve` | Console | ✅ | Resolve + update Case + write Trace + await+retry agent notification |
| `DELETE /api/human-tasks/[id]/delete` | Console | ✅ | Debug: deletes task + case + traces |
| `GET+PUT /api/admin/agent` | Console | ✅ | Agent config CRUD (upsert) |
| `GET+POST /api/admin/skills` + `[name]` | Console | ✅ | Skills full CRUD |
| `GET+POST /api/admin/policies` + `[name]` | Console | ✅ | Policies full CRUD |
| `GET+POST /api/admin/case-types` + `[name]` | Console | ✅ | Case types full CRUD |
| `GET+POST /api/admin/routing` + `[name]` | Console | ✅ | Routing full CRUD |

## 6. Cross-cutting

| Item | Status | Notes |
|------|--------|-------|
| Monorepo structure | ✅ | apps/chat, apps/console, packages/shared |
| Shared types | ✅ | packages/shared/types/index.ts |
| Shared Prisma | ✅ | Single SQLite, absolute path in .env.local per app |
| Shared UI primitives | ✅ | GlassCard, GlassInput, StatusPill, IconButton, ThemeToggle, FluidBackground |
| Console next.config.js | ✅ | Rewrites proxy /api/human-chat → chat app (avoids CORS in dev) |
| Console globals.css | ✅ | glass-admin, glass-sidebar, glass-card-hover, scroll-thin, animate-breathe, animate-fade-up |
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
| Operator consults agent → finalize_consultation | ✅ | Human-chat SSE stream, agent calls finalize_consultation with customer-facing summary |
| Human resolves → triggers customer update | ✅ | await+retry (3x) POST to /api/messages with spec prompt → SSE notifies chat app via consultation_complete |
| Agent resumes after human resolution | ✅ | Console POSTs to Chat /api/messages via notifyAgentResume() helper |
| Event-driven human resolution notification | ✅ | human-chat/route.ts await+retry triggers /api/messages → SSE consultation_complete → chat page inserts customer-visible message |
| Form-based info collection | ✅ | request_user_input skill + FormCard UI + form_request SSE |
| Customer queues messages while agent busy | ✅ | Messages queued, flushed after message_stop, pill indicator shows count |
| Admin configures agent behavior | ✅ | Admin pages + DB loading at runtime with 30s TTL cache. System prompt / model / policy hooks all hot-reload. |
| Console views case trace timeline | ✅ | Color-coded action types, token usage, tool latency, expandable payloads |
| Console views conversation history | ✅ | Messages persisted to DB, viewable in case detail page |
| Console edits case memory | ✅ | Summary, facts, missing facts editable. Skills/results/events read-only. |
| Agent loads skills/policies from DB | ✅ | Built-ins as fallback, DB entries override by name. Hot-reload without restart. |

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
| Agent Core Engine | 7/8 | Profiler |
| Chat Frontend | 14/16 | CaseRail sidebar, inline trace |
| Console (Ops) | 7/7 | — |
| Console (Admin) | 5/5 | — |
| Data Layer | 11/11 | — |
| API Routes | 17/17 | — |
| End-to-End Flows | 14/14 | — |
| CC Alignment | 2/12 | 10 remaining gaps (see §8) |

### Changes since 2026-04-29

**Phase 1-2 (Trace + Messages):**
- TraceWriter: MOCK → DB (fire-and-forget), new `llm_request_start`/`llm_response` types
- Messages: in-memory → persisted to `Message` table after each agent loop
- Fixed `summary` persistence bug in both `messages/route.ts` and `human-chat/route.ts`

**Phase 3 (Memory Editor):**
- `GET+PUT /api/cases/[id]/memory` with JSON validation + audit trace
- `/ops/cases/[id]/memory` two-column editor page

**Phase 4 (Admin Pages):**
- 9 Admin API routes (full CRUD for AgentConfig, Skills, Policies, CaseTypes, Routing)
- 5 Admin pages with glass-sidebar layout
- Console globals.css: glass-sidebar, animate-breathe, animate-fade-up

**Phase 5 (Runtime Wiring):**
- AgentConfig loaded from DB with 30s TTL cache → Admin changes take effect within 30s
- SkillRouter/Policies loaded from DB via `create()` factory → built-ins as fallback
- `AgentLoop.create()` replaces `new AgentLoop()` everywhere
