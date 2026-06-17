#!/bin/bash
# deploy.sh — Intera Console update script (Ubuntu standalone)
# Usage: sudo -iu intera ./scripts/deploy.sh
set -e

restart_unit() {
  local unit="$1"
  local old_pid new_pid active

  old_pid="$(systemctl show "$unit" -p MainPID --value 2>/dev/null || true)"
  if systemctl --no-ask-password restart "$unit" 2>/tmp/intera-systemctl-restart.err; then
    echo "$unit restarted via systemctl"
  else
    cat /tmp/intera-systemctl-restart.err >&2 || true
    if [ -z "$old_pid" ] || [ "$old_pid" = "0" ]; then
      echo "Unable to restart $unit: systemctl restart failed and no running PID is available for fallback" >&2
      exit 1
    fi

    echo "$unit systemctl restart unavailable; killing PID $old_pid so systemd can restart it"
    kill -9 "$old_pid"
  fi

  for _ in $(seq 1 30); do
    sleep 1
    active="$(systemctl is-active "$unit" 2>/dev/null || true)"
    new_pid="$(systemctl show "$unit" -p MainPID --value 2>/dev/null || true)"
    if [ "$active" = "active" ] && [ -n "$new_pid" ] && [ "$new_pid" != "0" ] && [ "$new_pid" != "$old_pid" ]; then
      echo "$unit active with PID $new_pid"
      return 0
    fi
  done

  echo "$unit did not restart cleanly" >&2
  systemctl status "$unit" --no-pager -l || true
  exit 1
}

# Load environment variables for Prisma / build
if [ -f /etc/intera/console.env ]; then
  set -a
  . /etc/intera/console.env
  set +a
fi

cd ~/intera-agent

# post-receive hooks export GIT_DIR/GIT_WORK_TREE for the bare repo context.
# Clear them before using the working tree repo's own remotes/index.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES

# Always realign via the working tree repo itself. The post-receive hook may
# have checked files out from the bare repo already, but that path has produced
# inconsistent HEAD/index/tree state on this host and unstable Next builds.
DEPLOY_REMOTE="${INTERA_DEPLOY_REMOTE:-bare}"
DEPLOY_REF="${INTERA_DEPLOY_REF:-main}"
if ! git remote get-url "$DEPLOY_REMOTE" >/dev/null 2>&1; then
  DEPLOY_REMOTE="origin"
fi

echo "=== Sync repo (${DEPLOY_REMOTE}/${DEPLOY_REF}) ==="
git fetch --force "$DEPLOY_REMOTE" "$DEPLOY_REF"
TARGET_SHA="$(git rev-parse FETCH_HEAD)"
git reset --hard "$TARGET_SHA"
echo "Deploy target: $TARGET_SHA"

# Best-effort cleanup for stale tracked deletions / moved paths without relying
# on broad git clean, which can fail on root-owned artifact directories.
# Remove stale files deleted in repo but lingering in work tree
rm -rf \
  apps/console/app/api/human-chat \
  apps/console/app/api/composer-assist \
  apps/console/app/api/coordinate \
  apps/console/lib/agent/consultation-agent.ts \
  apps/console/lib/composer-assist-config.ts \
  apps/console/lib/deepseek-prefix-chat.ts \
  apps/console/components/AgentHumanInteractionPanel.tsx \
  || true
echo "=== Install ==="
rm -rf node_modules
npm ci --include=dev

echo "=== Prisma migrate ==="
npm exec prisma migrate deploy --schema=packages/shared/prisma/schema.prisma

echo "=== Prisma ==="
npm run db:generate

echo "=== Clean build cache ==="
rm -rf apps/console/.next

echo "=== Build ==="
npm run build:console

echo "=== Copy static assets ==="
cp -r apps/console/.next/static apps/console/.next/standalone/apps/console/.next/static
cp -r apps/console/public apps/console/.next/standalone/apps/console/public

# Prisma engine (only if missing — nft sometimes skips platform binaries)
if [ ! -d apps/console/.next/standalone/node_modules/.prisma ]; then
  cp -r node_modules/.prisma apps/console/.next/standalone/node_modules/.prisma
fi
if [ ! -d apps/console/.next/standalone/node_modules/@prisma/client ]; then
  cp -r node_modules/@prisma/client apps/console/.next/standalone/node_modules/@prisma/client
fi

if [ -n "${INTERA_RUNTIME_URL:-}" ]; then
  echo "=== Restart runtime ==="
  if ! systemctl list-unit-files intera-runtime.service >/dev/null 2>&1; then
    echo "INTERA_RUNTIME_URL is set but intera-runtime.service is not installed" >&2
    exit 1
  fi
  restart_unit intera-runtime.service
else
  echo "=== Runtime ==="
  echo "INTERA_RUNTIME_URL not set; skipping intera-runtime.service"
fi

echo "=== Restart ==="
restart_unit intera-console.service

echo "=== Console health check ==="
sleep 2
curl -fsS localhost:3000/api/health && echo ""
if [ -n "${INTERA_RUNTIME_URL:-}" ]; then
  echo "=== Runtime health check ==="
  curl -fsS "${INTERA_RUNTIME_URL%/}/internal/health" && echo ""
fi
echo "Done."
