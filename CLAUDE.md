# Intera Agent

Monorepo with two Next.js apps (`apps/chat`, `apps/console`) and shared packages (`packages/shared`).

## Deploying to Railway

**Never rewrite `railway.json`** — it's committed to the repo and only changes when build/deploy commands actually change.

**Never use `sleep` + polling** — Railway CLI can follow deploy logs directly.

**Never re-run `railway service link`** — service links are persistent.

### Quick deploy

```bash
./scripts/deploy.sh chat     # deploys apps/chat
./scripts/deploy.sh console  # deploys apps/console
```

### Manual deploy

```bash
# Chat (uses railway.json build config, Next.js standalone)
railway up --service chat

# Console (uses Nixpacks via Railway variables)
railway up --service console
```

### Service configs

| Service | Build | Start | Mechanism |
|---------|-------|-------|-----------|
| chat | `railway.json` (Next standalone) | `railway.json` | Railway native build |
| console | `NIXPACKS_PKGS_CMD` = `npm run build:console` | `NIXPACKS_CMD` = `cd apps/console && npx next start` | Nixpacks |
| Postgres | — | — | Railway template |

### Checking status

```bash
railway deployment list --service chat --json | python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['status'])"
railway logs --service chat
```

### Important paths

- `railway.json` — chat's build/deploy config (committed, don't rewrite)
- `packages/shared/prisma/schema.prisma` — database schema
- `.env.local` — local environment variables (not committed)
