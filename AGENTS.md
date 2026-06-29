# Repository Guidelines

## Project Structure & Module Organization

This npm workspace monorepo powers Intera, an AI customer support SaaS. `apps/console` is the Next.js 15 operator console: routes live in `app/`, components in `components/`, and helpers in `lib/`. `apps/runtime/src` hosts the internal runtime service. `packages/runtime-core/src` contains shared agent/runtime logic. `packages/shared` contains contracts, UI primitives, types, memory helpers, and Prisma schema/migrations in `prisma/`. Use `scripts/` for operational checks, `deploy/` for service assets, `doc/` for specs/reports, and `templates/` for agent templates.

## Read Order For Intera Work

Before changing code, read `doc/README.md`, then the current source of truth `doc/spec/Intera_Harness_架构梳理.md`. For delivery risk, read `doc/handoffs/HARD_BUGS.md` and `doc/handoffs/DELIVERY_UNCERTAINTY_LOG.md`. For AgentOps Harness work, also read `doc/to-do/2026-06-26-agentops-harness-mvp-execution-plan.md`.

## Build, Test, and Development Commands

- `docker compose up -d`: start local PostgreSQL.
- `npm run db:push && npm run db:seed`: apply the Prisma schema and seed the default organization/demo data.
- `npm run dev:console`: run the console locally on port 3001.
- `npm run build:console`: build the Next.js console.
- `npm test`: run migration/boundary checks plus the full Vitest suite.
- `npm run test:coverage`: run Vitest coverage.

## Coding Style & Naming Conventions

Use strict TypeScript, 2-space indentation, single quotes, and no semicolons. Prefer named exports for shared modules and PascalCase for React components. Keep files kebab-case, such as `conversation-detail-workspace.tsx`; tests should mirror the subject with `.test.ts` or `.test.tsx`. Prefer aliases like `@/` and `@intera/shared/*`.

## Architecture Rules

Use current vocabulary only: `AgentConfig`, `Procedure`, `ProcedureRun`, `Tool`, `Hook`, `HookBinding`, `Scenario`, `ConfigPilot`, `AgentOps Control Plane`, and `intera-ops`. Do not introduce new `Skill`, `Policy`, `Guardrail`, `stage`, `sub-agent`, or code-level `playbook` identifiers. Agent-owned runtime/config/operate reads must require explicit `agentId` or `agentConfigId` and verify org ownership. External agent writes must go through typed draft proposal APIs; never mutate active Agent config directly. If a lane creates a new center, include the old-center remove list in the same PR.

## Testing Guidelines

Vitest discovers `**/*.test.ts` and `**/*.test.tsx`, including colocated tests and `__tests__` folders. Add focused tests for changed route handlers, domain logic, and UI behavior. Coverage thresholds apply to livechat code: 80% lines/functions/statements and 75% branches.

## Commit & Pull Request Guidelines

Git history uses scoped Conventional Commits, for example `fix(console): collapse tool trace details by default` or `chore(reports): mark resolved audit cases`. Keep commits small. Pull requests should include a summary, issue/context, commands run, and screenshots or recordings for visible UI changes.

## Security & Configuration Tips

Never commit secrets or local databases. Start from `.env.example` and deployment examples, keeping `DATABASE_URL`, `SESSION_SECRET`, provider API keys, and `INTERNAL_API_SECRET` local. Run `npm run check:runtime-core-boundary` before moving code between console and runtime-core.

## Production Access Rules

Inspect production only when the user explicitly asks. Host: `ubuntu@43.134.51.138`. Credentials must be supplied interactively and never written to this repo, shell history, scripts, docs, or logs. Treat production as read-only: do not edit files, run migrations, restart services, deploy, install packages, mutate the database, or execute write queries. Prefer `pwd`, `ls`, `git status`, `journalctl` reads, `systemctl status`, and read-only SQL (`SELECT`, `EXPLAIN`). If a fix requires production changes, stop and ask for explicit approval plus a backup/rollback plan.
