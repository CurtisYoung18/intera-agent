/**
 * Vitest guard: fails CI if two migration directories share the same
 * 14-digit timestamp prefix (which would break prisma migrate deploy).
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

describe('migration prefix collision guard', () => {
  it('has no duplicate timestamp prefixes in migration directories', () => {
    const entries = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)

    const prefixMap = new Map<string, string[]>()
    for (const dir of dirs) {
      const prefix = dir.slice(0, 14)
      if (prefix.length < 14 || !/^\d{14}$/.test(prefix)) continue
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
