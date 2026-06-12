import { config as loadDotEnv } from 'dotenv'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Env layering (matches README):
//   1. monorepo-root  .env       — shared API keys (MiniMax / DeepSeek / Anthropic)
//   2. app-local      .env.local — per-app DATABASE_URL override
// Both are loaded explicitly because Next.js only auto-loads files from the
// app directory and stops there. App-local wins (override:true) so Intera's
// MiniMax config also beats stray DeepSeek vars from the shell (e.g. CC).
function loadEnvLayered(): void {
  const rootEnv: string[] = []
  const appLocal: string[] = []
  const testLocal: string[] = []
  let dir = resolve(process.cwd())
  for (let i = 0; i < 10; i++) {
    const local = resolve(dir, '.env.local')
    const test = resolve(dir, '.env.test.local')
    const plain = resolve(dir, '.env')
    if (existsSync(local)) appLocal.push(local)
    if (existsSync(test)) testLocal.push(test)
    if (existsSync(plain)) rootEnv.push(plain)
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  // Load lowest precedence first (root .env), highest last (nearest .env.test.local
  // with override). Walking up means furthest = deepest in array — load in
  // reverse so the monorepo root .env is applied first.
  for (const path of rootEnv.reverse()) loadDotEnv({ path })
  for (const path of appLocal.reverse()) loadDotEnv({ path, override: true })
  for (const path of testLocal.reverse()) loadDotEnv({ path, override: true })
}
loadEnvLayered()

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const datasourceUrl = process.env.DATABASE_URL

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(datasourceUrl ? { datasourceUrl } : {}),
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// Lazy-init safety net for dev: ensures the parent Organization row exists before
// any admin route inserts an Organization-FK child. `npm run db:seed` covers this
// normally; this guards the "db:push but skipped seed" path so admin routes don't
// 500 with P2003.
export async function ensureDefaultOrg(orgId = 'default'): Promise<void> {
  await prisma.organization.upsert({
    where: { id: orgId },
    update: {},
    create: { id: orgId, name: 'Demo Org' },
  })
}
