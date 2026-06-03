/**
 * Dev / local SQLite drift: when `schema.prisma` gains columns but `db push` was not run,
 * Prisma reads fail with "SQLITE_ERROR: no such column ..." → 500 from Admin APIs.
 * This adds missing columns idempotently (SQLite only).
 */
import type { PrismaClient } from '@prisma/client'

function isSqliteFileUrl(): boolean {
  const u = process.env.DATABASE_URL || ''
  return u.startsWith('file:') || u.includes('.db') || u.toLowerCase().includes('sqlite')
}

type PragmaRow = { name: string }

export async function ensureSqliteSchemaCompat(prisma: PrismaClient): Promise<void> {
  if (!isSqliteFileUrl()) return

  const tableColumns = async (table: string): Promise<Set<string>> => {
    const rows = await prisma.$queryRawUnsafe<PragmaRow[]>(`PRAGMA table_info(${table})`)
    return new Set(rows.map((r) => r.name))
  }

  const add = async (table: string, column: string, sqlType: string) => {
    const cols = await tableColumns(table)
    if (cols.has(column)) return
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${sqlType}`)
  }

  try {
    await add('agent_configs', 'maxOutputTokens', 'INTEGER')
    await add('agent_configs', 'coreSystemPrompt', 'TEXT')
    await add('agent_configs', 'resumePrompt', 'TEXT')

    await add('case_types', 'stageConfigs', 'TEXT')
    await add('case_types', 'orchestratorConfig', 'TEXT')
    await add('case_types', 'autoCloseConditions', 'TEXT')
    await add('case_types', 'enabled', 'INTEGER NOT NULL DEFAULT 1')

    await add('skills', 'displayVerb', 'TEXT')
    await add('skills', 'toolCategory', 'TEXT')
    await add('cases', 'chatId', 'TEXT')
    await add('human_tasks', 'chatLog', 'TEXT')
    await add('human_tasks', 'customerMessage', 'TEXT')

    // Create chat_sessions table if it doesn't exist
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "chat_sessions" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "chatId" TEXT NOT NULL UNIQUE,
        "org_id" TEXT NOT NULL DEFAULT 'default',
        "confirmedFacts" TEXT NOT NULL DEFAULT '{}',
        "summary" TEXT,
        "keyEvents" TEXT NOT NULL DEFAULT '[]',
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
  } catch (e) {
    console.warn('[prisma] SQLite schema compat skipped or partial:', e)
  }
}
