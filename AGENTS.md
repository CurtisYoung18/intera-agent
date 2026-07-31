# Repository Guidelines

## Project Structure & Module Organization

This npm workspace monorepo powers Intera, an AI customer-support AgentOps
platform. `apps/console` is the Next.js 15 operator console: routes live in
`app/`, components in `components/`, and helpers in `lib/`. `apps/runtime/src`
hosts the internal runtime service. `packages/runtime-core/src` contains shared
execution logic. `packages/shared` contains contracts, UI primitives, types,
memory helpers, and the Prisma schema and migrations in `prisma/`. Use
`scripts/` for validation tooling, `doc/` for specifications, and `templates/`
for portable Agent examples.

## Read Order For Intera Work

Before changing code, read `doc/README.md`, then the current source of truth
`doc/spec/Intera_Harness_架构梳理.md`. For delivery risk, read
`doc/handoffs/HARD_BUGS.md` and
`doc/handoffs/DELIVERY_UNCERTAINTY_LOG.md`. For AgentOps Harness work, also read
`doc/to-do/2026-06-26-agentops-harness-mvp-execution-plan.md`.

## Build, Test, and Development Commands

- `docker compose up -d`: start local PostgreSQL.
- `npm run db:push && npm run db:seed`: apply the schema and seed demo data.
- `npm run dev:console`: run the console locally on port 3001.
- `npm run build:console`: build the Next.js console.
- `npm test`: run boundary checks and the full Vitest suite.
- `npm run test:coverage`: run Vitest coverage.

## Coding Style & Naming Conventions

Use strict TypeScript, 2-space indentation, single quotes, and no semicolons.
Prefer named exports for shared modules and PascalCase for React components.
Keep files kebab-case; tests should mirror the subject with `.test.ts` or
`.test.tsx`. Prefer aliases such as `@/` and `@intera/shared/*`.

## Architecture Rules

Use current vocabulary only: `AgentConfig`, `Procedure`, `ProcedureRun`, `Tool`,
`Hook`, `HookBinding`, `Scenario`, `ConfigPilot`, `AgentOps Control Plane`, and
`intera-ops`. Do not introduce new `Skill`, `Policy`, `Guardrail`, `stage`,
`sub-agent`, or code-level `playbook` identifiers. Agent-owned reads must
require an explicit `agentId` or `agentConfigId` and verify organization
ownership. External agent writes must use typed draft proposal APIs; never
mutate active Agent configuration directly.

## Testing Guidelines

Vitest discovers `**/*.test.ts` and `**/*.test.tsx`, including colocated tests
and `__tests__` folders. Add focused tests for changed route handlers, domain
logic, and UI behavior. Coverage thresholds apply to LiveChat code: 80%
lines/functions/statements and 75% branches.

## Commit & Pull Request Guidelines

Use scoped Conventional Commits, for example
`fix(console): collapse tool trace details by default`. Keep commits small.
Pull requests should include a summary, issue or context, commands run, and
screenshots or recordings for visible UI changes.

## Security & Configuration Tips

Never commit credentials, customer data, production evidence, local databases,
or browser auth state. Start from `.env.example` and keep all real values local.
Use synthetic fixtures in tests and documentation. Run Gitleaks before
publishing changes that touch configuration, traces, receipts, or examples.
