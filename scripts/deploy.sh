#!/usr/bin/env bash
set -euo pipefail

SERVICE="${1:-}"
if [[ -z "$SERVICE" ]]; then
  echo "Usage: ./scripts/deploy.sh <chat|console>"
  exit 1
fi

echo "==> Deploying $SERVICE to Railway..."

# railway up without --detach follows logs and waits for the deploy to finish.
# If you prefer a fire-and-forget CI style, replace with: railway up --service "$SERVICE" --ci
railway up --service "$SERVICE"

echo ""
echo "==> Checking deployment status..."
STATUS=$(railway deployment list --service "$SERVICE" --json 2>&1 | python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['status'])")

echo "==> $SERVICE: $STATUS"
if [[ "$STATUS" == "SUCCESS" ]]; then
  echo "==> Deploy complete: https://intera-$SERVICE.up.railway.app"
else
  echo "==> Deploy status: $STATUS — check logs with: railway logs --service $SERVICE"
  exit 1
fi
