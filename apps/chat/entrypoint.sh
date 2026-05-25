#!/bin/sh
set -e

echo "Running Prisma db push..."
npx prisma db push --schema=./packages/shared/prisma/schema.prisma --accept-data-loss --skip-generate

echo "Starting Intera Chat..."
# .next/standalone contents are copied to WORKDIR (/app), so server.js is at /app/server.js
# In monorepo standalone output, server.js is at apps/chat/ within standalone
exec node apps/chat/server.js
