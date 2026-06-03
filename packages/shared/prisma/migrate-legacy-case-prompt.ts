/**
 * Data migration: flip useLegacyCasePrompt from true to false for AgentConfig rows
 * that have already adopted the base+append model (both coreSystemPrompt and caseAddendum filled).
 *
 * **DOES NOT blindly flip all rows** — only the ones where both new fields are non-empty,
 * indicating the user has explicitly opted into base+append mode.
 *
 * Rows where coreSystemPrompt or caseAddendum is empty are kept on legacy (useLegacyCasePrompt=true).
 * These can be migrated later via the admin UI (fill the new fields and toggle the switch).
 *
 * Usage (from repo root):
 *   npx tsx packages/shared/prisma/migrate-legacy-case-prompt.ts
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadDotEnv } from 'dotenv'
import { PrismaClient } from '@prisma/client'

function loadEnv(): void {
  let dir = resolve(process.cwd())
  for (let i = 0; i < 10; i++) {
    const local = resolve(dir, '.env.local')
    const plain = resolve(dir, '.env')
    if (existsSync(local)) {
      loadDotEnv({ path: local })
      return
    }
    if (existsSync(plain)) {
      loadDotEnv({ path: plain })
      return
    }
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
}

async function main() {
  loadEnv()

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Aborting.')
    process.exit(1)
  }

  const prisma = new PrismaClient()

  console.log('=== Phase 2: Migrate legacy case prompt configs ===\n')

  // Find all configs currently on legacy mode (including null = legacy)
  const legacyConfigs = await prisma.agentConfig.findMany({
    where: {
      OR: [
        { useLegacyCasePrompt: true },
        { useLegacyCasePrompt: null },
      ],
    },
    select: {
      id: true,
      orgId: true,
      name: true,
      version: true,
      isActive: true,
      useLegacyCasePrompt: true,
      coreSystemPrompt: true,
      caseAddendum: true,
    },
    orderBy: [{ orgId: 'asc' }, { createdAt: 'desc' }],
  })

  console.log(`Found ${legacyConfigs.length} config(s) on legacy case prompt mode.\n`)

  let flipped = 0
  let kept = 0

  for (const cfg of legacyConfigs) {
    const hasCore = (cfg.coreSystemPrompt?.trim().length ?? 0) > 0
    const hasAddendum = (cfg.caseAddendum?.trim().length ?? 0) > 0

    if (hasCore && hasAddendum) {
      // Both fields filled — user clearly opted into base+append. Safe to flip.
      await prisma.agentConfig.update({
        where: { id: cfg.id },
        data: { useLegacyCasePrompt: false },
      })
      console.log(`  [FLIPPED] ${cfg.orgId}/${cfg.name} v${cfg.version} (${cfg.isActive ? 'active' : 'inactive'})`)
      flipped++
    } else {
      // Missing one or both fields — keep on legacy.
      kept++
      const missing = []
      if (!hasCore) missing.push('coreSystemPrompt')
      if (!hasAddendum) missing.push('caseAddendum')
      console.log(`  [KEPT]    ${cfg.orgId}/${cfg.name} v${cfg.version} (${cfg.isActive ? 'active' : 'inactive'}) — missing: ${missing.join(', ')}`)
    }
  }

  console.log(`\nDone. Flipped ${flipped}, kept ${kept} on legacy.`)
  if (kept > 0) {
    console.log('\n---')
    console.log('Configs kept on legacy have empty coreSystemPrompt and/or caseAddendum.')
    console.log('To migrate them:')
    console.log('  1. Open the Agent Config admin page for that org')
    console.log('  2. Fill "Core Prompt" with content (or use the default)')
    console.log('  3. Optionally add a "Case Addendum"')
    console.log('  4. Toggle "Use Legacy Case Prompt" to OFF (base+append mode)')
    console.log('\nOr use the one-time split helper if you want to derive coreSystemPrompt from systemPrompt.')
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
