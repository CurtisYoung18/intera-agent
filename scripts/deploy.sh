#!/usr/bin/env bash
set -euo pipefail

SERVICE="${1:-}"
if [[ -z "$SERVICE" ]]; then
  echo "Usage: ./scripts/deploy.sh <chat|console>"
  exit 1
fi

echo "==> Deploying $SERVICE to Railway..."

# Railway reads railway.json from the uploaded directory and applies it to the
# target service. Chat and console have different build/start commands.
# We swap railway.json per deployment.

TMP_JSON="/tmp/railway.${SERVICE}.json"

if [[ -f railway.json ]]; then
  cp railway.json "$TMP_JSON"
fi

case "$SERVICE" in
  chat)
    cat > railway.json <<'CHAT'
{
  "$schema": "https://schema.railway.app/railway.schema.json",
  "build": {
    "installCommand": "npm install --legacy-peer-deps",
    "buildCommand": "npm install --legacy-peer-deps && npx prisma generate --schema=./packages/shared/prisma/schema.prisma && npm run build -w apps/chat && cp -r apps/chat/.next/static apps/chat/.next/standalone/apps/chat/.next/static"
  },
  "deploy": {
    "startCommand": "npx prisma db push --schema=./packages/shared/prisma/schema.prisma --accept-data-loss --skip-generate && node apps/chat/.next/standalone/apps/chat/server.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
CHAT
    ;;
  console)
    cat > railway.json <<'CONSOLE'
{
  "$schema": "https://schema.railway.app/railway.schema.json",
  "build": {
    "installCommand": "npm install --legacy-peer-deps",
    "buildCommand": "npm install --legacy-peer-deps && npx prisma generate --schema=./packages/shared/prisma/schema.prisma && npm run build -w apps/console && cp -r apps/console/.next/static apps/console/.next/standalone/apps/console/.next/static"
  },
  "deploy": {
    "startCommand": "node apps/console/.next/standalone/apps/console/server.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
CONSOLE
    ;;
  *)
    echo "Unknown service: $SERVICE"
    exit 1
    ;;
esac

# Deploy
railway up --service "$SERVICE"

echo ""
echo "==> Checking deployment status..."
sleep 5
STATUS=$(railway deployment list --service "$SERVICE" --json 2>&1 | python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['status'])")

echo "==> $SERVICE: $STATUS"
if [[ "$STATUS" == "SUCCESS" ]]; then
  echo "==> Deploy complete: https://intera-$SERVICE.up.railway.app"
else
  echo "==> Deploy status: $STATUS — check logs with: railway logs --service $SERVICE"
fi

# Restore original railway.json
if [[ -f "$TMP_JSON" ]]; then
  mv "$TMP_JSON" railway.json
fi
