#!/bin/bash
# deploy.sh — Intera Console update script (Ubuntu standalone)
# Usage: sudo -iu intera ./scripts/deploy.sh
set -e

cd ~/intera-agent

# NOTE: `git pull` is intentionally omitted. The post-receive hook
# (`/var/git/intera.git/hooks/post-receive`) already checks the new
# commit into this working tree via `git --work-tree=… --git-dir=… checkout`,
# and that mode leaves the work tree's HEAD/index behind, so a `git pull`
# here would fail with "fatal: not a git repository: '.'". If you want
# to run this script manually (not from the hook), do
#   sudo -iu intera git pull origin main
# yourself first, then invoke the script.

echo "=== Install ==="
npm ci

echo "=== Prisma ==="
npm run db:generate

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

echo "=== Restart ==="
sudo systemctl restart intera-console

echo "=== Health check ==="
sleep 2
curl -s localhost:3000/api/health && echo ""
echo "Done."
