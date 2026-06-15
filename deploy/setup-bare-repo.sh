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

echo "=== Deploy script source ==="
echo "post-receive will run the repository's checked-out scripts/deploy.sh."
echo "This setup script intentionally does not generate or overwrite deploy.sh,"
echo "so migrations, runtime health checks, and cleanup logic stay versioned."

echo "=== Setup complete ==="
echo "git remote add deploy ssh://intera@43.134.51.138/var/git/intera.git"
