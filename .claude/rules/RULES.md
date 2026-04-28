# Team Rules — AI Programming File Ownership

> **Purpose:** Prevent AI tools from modifying files outside the intended scope of a session.
> These rules are enforced by the developer, not automatically. You are responsible for
> telling your AI which files it may and may not touch.

---

## Current Workflow

- **Primary Developer (Curtis):** Writes all production code with AI assistance.
- **Other Team Members:** Test, review, and provide feedback/suggestions.
- **AI Role:** Code generation and refactoring within explicitly stated boundaries.

When the team grows, the role-based ownership rules below become the split template.

---

## Rule 0: Universal Rule

**Before every AI coding session, tell the AI which files it may touch.**
If the AI tries to modify a file outside the stated scope, reject the change and remind it
of the boundaries. Do not let AI drift into unrelated files without explicit permission.

---

## Rule 1: Module Boundaries

Even as a solo developer, keep AI changes scoped to one module at a time. Mixing
Agent engine changes with Admin UI changes in one AI session leads to messy diffs
and harder review.

### Module A — Agent Core Engine

**Scope:** Agent Loop, Memory, Skills, Policy, Trace, StreamingToolExecutor, LLM integration

```
lib/try/agent/loop.ts
lib/try/agent/memory.ts
lib/try/agent/skills.ts
lib/try/agent/policy.ts
lib/try/agent/trace.ts
lib/try/agent/streaming-tool-executor.ts
app/api/try/messages/route.ts
```

### Module B — Admin Console & Data Layer

**Scope:** Admin configuration pages, Prisma schema, database access

```
prisma/schema.prisma
lib/prisma.ts
app/try/admin/**/*
app/api/try/admin/**/*
```

### Module C — Human Task System

**Scope:** Human task pages, human task API, case resume flow

```
app/try/ops/human-tasks/**/*
app/api/try/human-tasks/**/*
app/try/ops/cases/**/*
```

### Shared Infrastructure

Changes to these files should be intentional and minimal:

```
types/index.ts        — Type definitions used by all modules
package.json          — Dependencies
tsconfig.json         — Build config
next.config.js        — Routing / build config
.env.example          — Environment template
```

---

## Rule 2: AI Logging

Every AI-assisted change MUST be logged in `.claude/logs/[your-name].md`
following the template in `TEMPLATE.md`.

**Log entries must include:**
- Date and time
- AI tool and model
- Exact files changed
- Summary of what the AI did
- Any manual corrections needed

---

## Rule 3: Code Review

1. **AI-generated code must be reviewed before merging.** Never blind-merge AI output.
2. **Run `npx prisma generate` and `npm run build`** before marking a PR ready if the schema or types changed.
3. **Testers verify behavior, not implementation.** They confirm the feature works as expected; the developer owns code correctness.

---

## Rule 4: Mock vs Production Code

- Code marked with `// [MOCK]` is placeholder. It may use simulated data or skip real I/O.
- Before removing a `// [MOCK]` marker:
  1. Implement the real DB query / API call / logic
  2. Test it end-to-end
  3. Remove the `// [MOCK]` comment
- Do NOT remove `// [MOCK]` markers without implementing the production path.

---

## Future: Multi-Developer Split

When the team expands, the boundaries above become hard ownership rules:

| Role | Module | May Also Read |
|------|--------|---------------|
| Agent Engine Dev | Module A | types, schema |
| Admin/Data Dev | Module B | types, agent/ |
| Human Task Dev | Module C | types, loop.ts, memory.ts, schema |

Cross-module changes require a heads-up in the PR description.
