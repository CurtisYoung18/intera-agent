# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev:chat          # Chat app on port 3000
npm run dev:console       # Console app on port 3001

# Build
npm run build:chat
npm run build:console

# Database (SQLite local, PostgreSQL production)
npm run db:generate       # Regenerate Prisma client
npm run db:push           # Push schema to database
npm run db:seed           # Seed default data (required for dev)
npm run db:studio         # Open Prisma Studio GUI

# Testing
npm test                  # Run all tests
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage report
npx vitest run path/to/file.test.ts  # Run a single test file

# Worker (runs alongside chat app in production)
npm run worker:continuation -w apps/chat
```

## Architecture

This is an **npm workspaces monorepo** with two Next.js 15 App Router apps and a shared package. Both apps use `output: 'standalone'` and `transpilePackages: ['@intera/shared']`.

### Apps

- **`apps/chat`** (`@intera/chat`, port 3000) — Customer-facing chat UI **and** the entire AI agent orchestration backend. React 19, Tailwind v4.
- **`apps/console`** (`@intera/console`, port 3001) — Operator/admin harness for human tasks, case review, and configuration. React 19, Tailwind v3, lucide-react icons.

### Packages

- **`packages/shared`** (`@intera/shared`) — Prisma schema/client, TypeScript types, default seed data (skills, policies, case types, prompts), and shared UI components.

### Agent Loop (the core engine)

The central AI agent runtime lives in `apps/chat/lib/agent/`. The main entry point is `loop.ts` — a ReAct loop wrapping the Anthropic SDK with SSE streaming. Key subsystems:

| Module | Purpose |
|--------|---------|
| `loop.ts` | Core ReAct engine — streaming LLM calls with parallel tool execution |
| `conversation-loop.ts` | Lightweight "discovery" mode when no case is active |
| `case-agent-loop.ts` | Stage-gated execution when a case is active |
| `stage-executor.ts` | Enforces CaseType state machine transitions (required skills, evidence checks, LLM-based transition evaluation) |
| `orchestrator.ts` | Dispatches parallel sub-agents for multi-faceted investigation |
| `sub-agent.ts` | Isolated agent execution with independent model/prompt/tools |
| `memory.ts` | 4-tier context compression (L1: recent messages, L2: summary, L3: facts/events, L4: historical) |
| `policy.ts` | Guardrail engine — preTool/postTool/preFinalize hooks |
| `skills.ts` | Skill registry routing (engine-managed, HTTP, static modes) |
| `streaming-tool-executor.ts` | Concurrent tool execution during streaming responses |
| `trace.ts` | Action trace logging for observability |

The agent supports two conversation modes that share the same `AgentLoop` class:
1. **Core mode** (no case active) — filtered tools, lightweight prompt, designed for discovery and case creation
2. **Case mode** — full system prompt, stage-gated execution driven by `CaseType` state machine config

### Console ↔ Chat relationship

The console's `next.config.js` proxies `/api/admin/config-changed` and `/api/composer-assist/*` to the chat app. The chat app hosts all agent logic; the console is a configuration UI + human-task dashboard.

### Database

Prisma ORM with SQLite for local dev and PostgreSQL in production. Schema at `packages/shared/prisma/schema.prisma`.

Key models: `Customer` (tenant), `AgentConfig`, `CaseType` (dynamic state machine), `Skill`, `Policy` (guardrails), `Case`, `CaseMemory` (structured working memory per case), `Message`, `ActionTrace` (audit log), `HumanTask`, `ExternalConversation` (LiveChat/Intercom/Tawk mapping), `ChannelBinding`.

## Conventions

- **Env layering**: Root `.env` holds shared secrets (API keys). Each app has `.env.local` for `DATABASE_URL` override. The Prisma singleton in `packages/shared/prisma/index.ts` walks up the directory tree to load `.env` files since Next.js doesn't traverse parent directories.
- **Tailwind**: Chat uses v4 (`@theme` in CSS, `@tailwindcss/postcss`). Console uses v3 (`tailwind.config.ts`). Both share the same CSS custom property design tokens (neutral palette, accent colors, surface/shadows).
- **i18n**: Custom React Context (`LocaleProvider`) with flat dictionaries in `apps/console/lib/i18n/dictionaries.ts`. Two locales: `zh-CN` and `en`. Persisted to `localStorage`. Supports `{var}` interpolation.
- **No form library, no state management library** — forms use raw state, chat state lives in the monolithic `useInteraChat` hook (`apps/chat/app/chat/use-intera-chat.ts`).
- **No `middleware.ts`** — auth checks happen per-route. Console auth is cookie-based with bcryptjs.
- **All API routes use Next.js Route Handlers** (no Server Actions, no tRPC). Pattern: `async function GET/POST(req: NextRequest)` with try-catch returning `NextResponse.json()`.
- **All Prisma models use `@@map("snake_case")`** for PostgreSQL compatibility.
- **Light mode only** — no dark mode support in either app.

## Testing

Vitest with `@vitest/coverage-v8`. Config aliases `@` → `apps/chat`. Tests use `vi.useFakeTimers()` for timer-dependent code and `vi.fn()` for mocking.

Coverage targets (80% lines/functions/statements, 75% branches) currently scoped to:
- `apps/chat/lib/livechat/**/*.ts`
- `apps/chat/channels/livechat/**/*.ts`

Test locations:
- `apps/chat/lib/agent/__tests__/` — unit, integration, regression, smoke, factories, mocks
- `apps/chat/lib/livechat/__tests__/` — unit, integration, mocks
- `apps/console/components/admin/__tests__/`

## Deployment

Railway via `railway.json` + `scripts/deploy.sh`. The deploy script swaps `railway.json` between chat and console service configs. Both use `output: 'standalone'` — static assets must be manually copied post-build. The chat service runs `prisma db push` on start; the console does not.
