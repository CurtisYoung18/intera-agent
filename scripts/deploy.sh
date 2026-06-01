#!/bin/bash
# deploy.sh — Intera Console update script (Ubuntu standalone)
# Usage: sudo -iu intera ./scripts/deploy.sh
set -e

cd ~/intera-agent

echo "=== Pull ==="
git pull origin main

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
