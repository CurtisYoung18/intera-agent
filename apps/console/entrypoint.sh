#!/bin/sh
set -e

echo "Running Prisma db push..."
npx prisma db push --schema=./packages/shared/prisma/schema.prisma --accept-data-loss --skip-generate

echo "Starting Intera Console..."
# .next/standalone contents are copied to WORKDIR (/app), so server.js is at /app/server.js
exec node server.js
