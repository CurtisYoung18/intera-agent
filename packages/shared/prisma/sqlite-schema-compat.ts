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
    await add('agent_configs', 'resumePrompt', 'TEXT')
    await add('agent_configs', 'formResponseTemplate', 'TEXT')
    await add('agent_configs', 'evaluationModel', 'TEXT')
    await add('agent_configs', 'intentModel', 'TEXT')
    await add('agent_configs', 'prefixContinuationEnabled', 'INTEGER NOT NULL DEFAULT 0')
    await add('agent_configs', 'prefixContinuationChatModel', 'TEXT')
    await add('agent_configs', 'prefixContinuationBaseUrl', 'TEXT')
    await add('agent_configs', 'prefixContinuationAssistantPrefix', 'TEXT')
    await add('agent_configs', 'prefixContinuationStop', 'TEXT')
    await add('agent_configs', 'prefixContinuationMinDraftChars', 'INTEGER NOT NULL DEFAULT 4')

    await add('case_types', 'stageConfigs', 'TEXT')
    await add('case_types', 'orchestratorConfig', 'TEXT')
    await add('case_types', 'autoCloseConditions', 'TEXT')
    await add('case_types', 'enabled', 'INTEGER NOT NULL DEFAULT 1')
  } catch (e) {
    console.warn('[prisma] SQLite schema compat skipped or partial:', e)
  }
}
