# Intera — Development Rules

> Curtis + Claude, building Intera together.

---

## Project Architecture

```
intera-agent/                    ← Monorepo, one Git repo
├── apps/
│   ├── chat/                    ← Chat App (customer-facing)
│   └── console/                 ← Harness Console (operator-facing: ops + admin)
├── packages/
│   └── shared/                  ← Shared types, Prisma schema, UI primitives
└── doc/                         ← Specs, roadmap, design docs
```

Two Next.js apps, one shared database (SQLite locally, Neon PostgreSQL in production).
Chat App on port 3000. Console on port 3001.
They communicate via HTTP API + shared SQLite.

---

## Current Workflow

- **Curtis:** Product direction, design decisions, code review, testing
- **Claude:** Code generation, refactoring, debugging
- **Session scope:** One module at a time. Don't mix Chat changes with Console changes.

---

## Development Rules

### Rule 1: Mock vs Production

- Code marked `// [MOCK]` is placeholder. May use simulated data.
- Before removing `// [MOCK]`:
  1. Implement the real logic (DB query, API call, etc.)
  2. Test end-to-end
  3. Remove the comment
- Never remove `// [MOCK]` without implementing the production path.

### Rule 2: Build Verification

- Run `npm run build:chat && npm run build:console` before claiming completion.
- If Prisma schema changed: also run `npx prisma generate --schema=packages/shared/prisma/schema.prisma`.
- Never trust dev server alone — the build step catches type errors and Tailwind tree-shaking issues.

### Rule 3: Tailwind Safety

- **Never use `@layer components` or `@layer utilities`** for critical app CSS. Tailwind JIT may tree-shake them. Put custom classes directly after `@tailwind utilities`.
- **When adding shared packages**, update BOTH apps' `tailwind.config.ts` `content` paths to include the new directory. Without this, Tailwind strips utility classes (e.g. `right-4`, `top-4`) used in shared components.

### Rule 4: Structural Changes

After any of these, run full build:
- Moving directories (`mv`, `git mv`)
- Changing `tsconfig.json` paths
- Changing `tailwind.config.ts` content paths
- Adding new workspace packages

### Rule 5: DB Path

- `DATABASE_URL` must be an absolute path in `.env.local` (each app needs its own copy). Relative paths break because each app has a different working directory.

### Rule 6: Built-in Skill Naming

- Use **generic, domain-agnostic names** for built-in skills. Follow Claude Code's pattern: `AskUserQuestion`, `EnterPlanMode`, `TodoWrite` — not `collect_deposit_info` or `check_game_recharge`.
- Good: `request_user_input`, `query_external_api`, `create_escalation`, `search_knowledge_base`
- Bad: `collect_customer_info`, `check_recharge_status`, `game_vendor_lookup`
- **Prefix convention**: Use verb-first naming: `request_*`, `query_*`, `create_*`, `search_*`, `read_*`, `finalize_*`

### Rule 7: Confirm Before Guessing

- If a design decision has trade-offs you're not sure about (e.g., field-level `required` semantics, error handling strategy, UX flow), **ask Curtis before implementing**. Guessing wastes tokens and time on corrections.

### Rule 8: Shared Code

- Types used by both apps belong in `packages/shared/types/`.
- UI primitives used by both apps belong in `packages/shared/ui/`.
- Changes to shared code require building both apps to verify.

### Rule 4: No Blind Merges

- All Claude-generated code must be reviewed by Curtis before merging.
- Test the feature in browser before declaring it done.

---

## AI Logging

Every Claude-assisted change is logged in `.claude/logs/session-YYYY-MM-DD.md`.
One file per session. Curtis reviews logs to track what was done.

Log format:
```markdown
# Session YYYY-MM-DD

## Changes
- `file/path.ts` — what changed and why

## Decisions
- Decision made and rationale

## Issues
- Any problems encountered
```
