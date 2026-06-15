> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# Fix Prisma monorepo seed bug

**Priority:** Immediate | **Risk:** Low | **Deploy:** No (codegen only)

## Context

Prisma 6 monorepo codegen produces duplicate type definitions for `AgentConfig.coreSystemPrompt` (defined 3 times: `string|null` × 2 + `number`). This causes `PrismaClientValidationError` when the seed script tries `agentConfig.upsert` for the `api` org. The app runs fine (runtime doesn't use those types), but the seed fails.

## Root cause

`generator client` block in `schema.prisma` has no explicit `output` path. In a monorepo with npm workspaces, Prisma may generate types into multiple locations, causing duplication.

## Fix

### `packages/shared/prisma/schema.prisma`

**Before:**
```prisma
generator client {
  provider = "prisma-client-js"
}
```

**After:**
```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../node_modules/.prisma/client"
}
```

This pins the generated client to a single location, preventing the duplication.

## Steps

1. Edit `packages/shared/prisma/schema.prisma` — add `output` line
2. Run `npx prisma generate --schema=./packages/shared/prisma/schema.prisma`
3. Verify the duplicate types are gone:
   ```bash
   grep -c "coreSystemPrompt" node_modules/.prisma/client/index.d.ts
   # Should return exactly 1 (was 3)
   ```
4. Run `npm run db:seed` — verify `api` org seeds without error:
   ```
   # Expected: no PrismaClientValidationError for agentConfig.upsert
   ```
5. Run `npm test` — all pass
6. Run `npm run build:console` — succeeds
7. Commit

## Note

The `api` org AgentConfig was previously inserted via raw SQL as a workaround. After this fix, `db:seed` will handle it automatically.
