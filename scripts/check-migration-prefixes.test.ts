/**
 * Vitest guard: fails CI if two migration directories share the same
 * numeric timestamp prefix (which would break prisma migrate deploy).
 *
 * The repo currently has both 14-digit and legacy 12-digit prefixes; both are
 * real Prisma migrations and must be checked.
 *
 * Known benign collision: 20260603000008 (two dirs share this prefix).
 * Future collisions are fatal.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATIONS_DIR = resolve(
  __dirname,
  '..',
  'packages/shared/prisma/migrations'
)

const KNOWN_COLLISIONS = new Set(['20260603000008'])

function migrationPrefix(dir: string): string | null {
  return /^(\d{12,14})(?=_)/.exec(dir)?.[1] ?? null
}

describe('migration prefix collision guard', () => {
  it('has no duplicate timestamp prefixes in migration directories', () => {
    const entries = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)

    const prefixMap = new Map<string, string[]>()
    for (const dir of dirs) {
      const prefix = migrationPrefix(dir)
      if (!prefix) continue
      const group = prefixMap.get(prefix) ?? []
      group.push(dir)
      prefixMap.set(prefix, group)
    }

    const collisions: Array<{ prefix: string; dirs: string[] }> = []
    for (const [prefix, names] of prefixMap) {
      if (names.length > 1 && !KNOWN_COLLISIONS.has(prefix)) {
        collisions.push({ prefix, dirs: names })
      }
    }

    expect(
      collisions,
      `Migration prefix collisions found: ${JSON.stringify(collisions)}`
    ).toHaveLength(0)
  })
})
