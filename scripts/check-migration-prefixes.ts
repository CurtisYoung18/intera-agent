#!/usr/bin/env npx tsx
/**
 * check-migration-prefixes.ts
 *
 * Guards against colliding migration directory prefixes.
 * Prisma generates migrations with a 14-digit timestamp prefix (YYYYMMDDHHMMSS).
 * Two directories with the same prefix will fail `prisma migrate deploy`.
 *
 * Known benign collision: 20260603000008 (two directories share this prefix).
 * This guard ensures no future collisions are introduced.
 */

import { readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const MIGRATIONS_DIR = resolve(
  process.cwd(),
  'packages/shared/prisma/migrations'
)

// Known benign collision — will not fail CI but will log a warning.
const KNOWN_COLLISIONS = new Set(['20260603000008'])

function main(): void {
  if (!existsSync(MIGRATIONS_DIR)) {
    console.error(`Migrations directory not found: ${MIGRATIONS_DIR}`)
    process.exit(1)
  }

  const entries = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)

  // Group by 14-char timestamp prefix
  const prefixMap = new Map<string, string[]>()
  for (const dir of dirs) {
    const prefix = dir.slice(0, 14)
    if (prefix.length < 14 || !/^\d{14}$/.test(prefix)) {
      console.warn(`Skipping non-migration directory: ${dir}`)
      continue
    }
    const group = prefixMap.get(prefix) ?? []
    group.push(dir)
    prefixMap.set(prefix, group)
  }

  // Check for collisions
  let hasCollision = false
  let hasNewCollision = false

  for (const [prefix, names] of prefixMap) {
    if (names.length > 1) {
      hasCollision = true
      if (KNOWN_COLLISIONS.has(prefix)) {
        console.warn(
          `WARNING: Known benign collision for prefix ${prefix}: ${names.join(', ')}`
        )
      } else {
        hasNewCollision = true
        console.error(
          `ERROR: Migration prefix collision for ${prefix}: ${names.join(', ')}`
        )
      }
    }
  }

  if (hasNewCollision) {
    console.error(
      '\nMigration prefix collisions will cause prisma migrate deploy to fail.\n' +
        'Rename one of the conflicting directories to use a later timestamp.'
    )
    process.exit(1)
  }

  if (hasCollision) {
    console.warn(
      '\nMigrate prefix check passed (known benign collisions only).'
    )
  } else {
    console.log('Migration prefix check passed — no collisions.')
  }

  process.exit(0)
}

main()
