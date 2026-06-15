#!/bin/bash
set -euo pipefail
BARE_REPO=/var/git/intera.git
WORK_TREE=/home/intera/intera-agent
DEPLOY_USER=intera

echo "=== Creating bare repo at $BARE_REPO ==="
mkdir -p "$BARE_REPO"
git init --bare "$BARE_REPO"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$BARE_REPO"

cat > "$BARE_REPO/hooks/post-receive" <<'HOOK'
#!/bin/bash
set -euo pipefail
BARE_REPO=/var/git/intera.git
WORK_TREE=/home/intera/intera-agent
DEPLOY_USER=intera
echo "[deploy] post-receive fired"
git --work-tree="$WORK_TREE" --git-dir="$BARE_REPO" checkout -f main 2>&1
echo "[deploy] checkout done, running deploy..."
cd "$WORK_TREE"
sudo -u "$DEPLOY_USER" bash scripts/deploy.sh 2>&1
echo "[deploy] done"
HOOK

chmod +x "$BARE_REPO/hooks/post-receive"
chown "$DEPLOY_USER:$DEPLOY_USER" "$BARE_REPO/hooks/post-receive"

cat > "$WORK_TREE/scripts/deploy.sh" <<'DEPLOY'
#!/bin/bash
set -euo pipefail
cd /home/intera/intera-agent
echo "[deploy] npm ci..."
npm ci --production=false 2>&1 | tail -3
echo "[deploy] db:generate..."
npm run db:generate 2>&1 | tail -3
echo "[deploy] build:console..."
npm run build:console 2>&1 | tail -5
echo "[deploy] cp static + public + prisma..."
cp -r apps/console/.next/static apps/console/.next/standalone/apps/console/.next/static
cp -r apps/console/public apps/console/.next/standalone/apps/console/public
sudo cp -r node_modules/.prisma apps/console/.next/standalone/node_modules/.prisma
if [ -n "${INTERA_RUNTIME_URL:-}" ]; then
  echo "[deploy] restarting runtime..."
  if ! systemctl list-unit-files intera-runtime.service >/dev/null 2>&1; then
    echo "INTERA_RUNTIME_URL is set but intera-runtime.service is not installed" >&2
    exit 1
  fi
  sudo systemctl restart intera-runtime
  sleep 1
  curl -fsS "${INTERA_RUNTIME_URL%/}/internal/health"
  echo ""
else
  echo "[deploy] runtime disabled; INTERA_RUNTIME_URL not set"
fi
echo "[deploy] restarting console..."
sudo systemctl restart intera-console
sleep 3
curl -s localhost:3000/api/health
echo ""
echo "[deploy] complete"
DEPLOY

chmod +x "$WORK_TREE/scripts/deploy.sh"
chown "$DEPLOY_USER:$DEPLOY_USER" "$WORK_TREE/scripts/deploy.sh"

echo "=== Setup complete ==="
echo "git remote add deploy ssh://intera@43.134.51.138/var/git/intera.git"
