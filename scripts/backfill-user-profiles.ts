import { Prisma, PrismaClient } from '@prisma/client'
import { mergeProfile } from '@intera/shared/memory/mergeProfile'

type ProfileRow = {
  id: string
  orgId: string
  agentConfigId: string | null
  userId: string
  profile: string
  sections: string
  updatedAt: Date
}

type Options = {
  apply: boolean
  limit: number
  minChars: number
  maxTokens: number
  userId?: string
  lockTimeoutMs: number
  statementTimeoutMs: number
}

const NOISE_PATTERN = [
  'tool_use',
  'tool_result',
  'read_user_profile',
  'kb_search',
  'ask_user_questions',
  'providerContent',
  'receipt',
  'screenshot',
  'caseId',
  'runId',
  'procedureRun',
  'No prior sessions',
  'No stable',
].join('|')

function readOptions(argv: string[]): Options {
  const options: Options = {
    apply: false,
    limit: 50,
    minChars: 10000,
    maxTokens: 4000,
    lockTimeoutMs: 500,
    statementTimeoutMs: 3000,
  }

  for (const arg of argv) {
    if (arg === '--apply') options.apply = true
    else if (arg.startsWith('--limit=')) options.limit = positiveInt(arg, '--limit=')
    else if (arg.startsWith('--min-chars=')) options.minChars = positiveInt(arg, '--min-chars=')
    else if (arg.startsWith('--max-tokens=')) options.maxTokens = positiveInt(arg, '--max-tokens=')
    else if (arg.startsWith('--user=')) options.userId = arg.slice('--user='.length)
    else if (arg.startsWith('--lock-timeout-ms=')) options.lockTimeoutMs = positiveInt(arg, '--lock-timeout-ms=')
    else if (arg.startsWith('--statement-timeout-ms=')) options.statementTimeoutMs = positiveInt(arg, '--statement-timeout-ms=')
    else if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function positiveInt(arg: string, prefix: string): number {
  const value = Number.parseInt(arg.slice(prefix.length), 10)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${prefix}${arg.slice(prefix.length)} must be a positive integer`)
  }
  return value
}

function usage(): void {
  console.log([
    'Usage:',
    '  npx tsx scripts/backfill-user-profiles.ts [--apply] [--limit=50] [--min-chars=10000]',
    '  npx tsx scripts/backfill-user-profiles.ts --user=user:livechat-TG1Z8PMQEI',
    '',
    'Defaults to dry-run. Use --apply to update matching rows.',
  ].join('\n'))
}

function countBullets(markdown: string): number {
  return markdown.split('\n').filter((line) => /^\s*[-*]\s+/.test(line)).length
}

async function loadRows(prisma: PrismaClient, options: Options): Promise<ProfileRow[]> {
  const where = options.userId
    ? Prisma.sql`"userId" = ${options.userId}`
    : Prisma.sql`(length(profile) >= ${options.minChars} or profile ~* ${NOISE_PATTERN})`

  return prisma.$queryRaw<ProfileRow[]>(Prisma.sql`
    select
      id,
      "orgId",
      agent_config_id as "agentConfigId",
      "userId",
      profile,
      sections,
      "updatedAt"
    from user_profiles
    where profile <> ''
      and ${where}
    order by length(profile) desc, "updatedAt" desc
    limit ${options.limit}
  `)
}

async function updateProfile(
  prisma: PrismaClient,
  row: ProfileRow,
  next: { profile: string; sections: string },
  options: Options,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '${options.lockTimeoutMs}ms'`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '${options.statementTimeoutMs}ms'`)
    return tx.$executeRaw`
      update user_profiles
      set profile = ${next.profile},
          sections = ${next.sections}
      where id = ${row.id}
        and profile = ${row.profile}
    `
  })
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2))
  const prisma = new PrismaClient()

  try {
    const rows = await loadRows(prisma, options)
    let changed = 0
    let updated = 0

    console.log(JSON.stringify({
      mode: options.apply ? 'apply' : 'dry-run',
      selectedRows: rows.length,
      limit: options.limit,
      minChars: options.minChars,
      userId: options.userId ?? null,
    }))

    for (const row of rows) {
      const next = mergeProfile(row.profile, '', options.maxTokens)
      const changedRow = next.profile !== row.profile || next.sections !== row.sections
      if (changedRow) changed += 1

      const summary = {
        id: row.id,
        orgId: row.orgId,
        agentConfigId: row.agentConfigId ?? '',
        userId: row.userId,
        beforeChars: row.profile.length,
        afterChars: next.profile.length,
        beforeBullets: countBullets(row.profile),
        afterBullets: countBullets(next.profile),
        changed: changedRow,
        updated: false,
      }

      if (options.apply && changedRow) {
        const count = await updateProfile(prisma, row, next, options)
        summary.updated = count === 1
        if (summary.updated) updated += 1
      }

      console.log(JSON.stringify(summary))
    }

    console.log(JSON.stringify({ done: true, changed, updated }))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
