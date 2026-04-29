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

- Run `npx next build` in the relevant app before claiming completion.
- If Prisma schema changed: also run `npx prisma generate`.

### Rule 3: Shared Code

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
