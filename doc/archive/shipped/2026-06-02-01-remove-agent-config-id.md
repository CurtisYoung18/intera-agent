> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# Remove `agentConfigId` YAGNI field from ApiKey schema

**Priority:** Immediate | **Risk:** Low | **Deploy:** Yes (`prisma db push` on server)

## Context

In `9899c74`, the `agentConfigId` field was supposed to be removed from the `ApiKey` model (YAGNI — not needed yet). The edit was applied but the field remained. It's dead code.

## Files to change

### `packages/shared/prisma/schema.prisma`

**Before (line 36):**
```prisma
model ApiKey {
  id            String    @id @default(cuid())
  orgId         String    @map("org_id")
  agentConfigId String?   @map("agent_config_id")
  name          String
  ...
}
```

**After:**
```prisma
model ApiKey {
  id         String    @id @default(cuid())
  orgId      String    @map("org_id")
  name       String
  ...
}
```

## Steps

1. Edit `packages/shared/prisma/schema.prisma` — remove the `agentConfigId` line
2. Run `npx prisma db push --schema=./packages/shared/prisma/schema.prisma --accept-data-loss` (local)
3. Run `npx prisma generate --schema=./packages/shared/prisma/schema.prisma`
4. Verify: `npx tsc --noEmit -p apps/console/tsconfig.json` — 0 errors
5. Verify: `npm test` — all pass
6. Verify: `npm run build:console` — succeeds
7. Commit

## Server-side (after merge)

```bash
ssh ubuntu@43.134.51.138
sudo -iu intera
cd ~/intera-agent
git pull origin main
npx prisma db push --schema=./packages/shared/prisma/schema.prisma --accept-data-loss
sudo systemctl restart intera-console
curl -s localhost:3000/api/health
```
