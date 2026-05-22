#!/bin/sh
set -e

echo "Running Prisma db push..."
npx prisma db push --schema=./packages/shared/prisma/schema.prisma --accept-data-loss --skip-generate

echo "Starting Intera Console..."
exec node apps/console/server.js
