import { config as loadDotEnv } from 'dotenv'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Force-load .env.local with override so Intera's MiniMax config takes priority
// over any CC DeepSeek env vars that may be set in the shell.
function loadEnvWithOverride(): void {
  let dir = resolve(process.cwd())
  for (let i = 0; i < 10; i++) {
    const local = resolve(dir, '.env.local')
    if (existsSync(local)) {
      loadDotEnv({ path: local, override: true })
      return
    }
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
}
loadEnvWithOverride()

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export { ensureSqliteSchemaCompat } from './sqlite-schema-compat'
