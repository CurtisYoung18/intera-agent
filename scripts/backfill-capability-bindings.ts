/**
 * Backfill capabilityBindings from existing policyHooks + enabled library items.
 *
 * Run from repo root:
 *   npx tsx scripts/backfill-capability-bindings.ts
 *
 * Idempotent: skips rows that already have non-null capabilityBindings.
 */
import { PrismaClient } from '@prisma/client'
import type { CapabilityBindings } from '../packages/shared/types/index'

const prisma = new PrismaClient()

async function main() {
  const configs = await prisma.agentConfig.findMany({
    select: { id: true, orgId: true, policyHooks: true, capabilityBindings: true },
  })

  let updated = 0
  let skipped = 0

  for (const config of configs) {
    // Idempotent: skip already-backfilled rows
    if (config.capabilityBindings) {
      skipped++
      continue
    }

    // Parse existing policyHooks for guardrails
    let guardrails: CapabilityBindings['guardrails'] = { preTool: [], postTool: [], preFinalize: [] }
    try {
      const ph = JSON.parse(config.policyHooks || '{}')
      if (ph && typeof ph === 'object') {
        guardrails = {
          preTool: Array.isArray(ph.preTool) ? ph.preTool : [],
          postTool: Array.isArray(ph.postTool) ? ph.postTool : [],
          preFinalize: Array.isArray(ph.preFinalize) ? ph.preFinalize : [],
        }
      }
    } catch { /* keep defaults */ }

    // Gather enabled library items for this org
    const [enabledSkills, enabledCaseTypes, enabledKnowledge] = await Promise.all([
      prisma.skill.findMany({ where: { orgId: config.orgId, enabled: true }, select: { name: true } }),
      prisma.caseType.findMany({ where: { orgId: config.orgId, enabled: true }, select: { type: true } }),
      prisma.knowledgeSource.findMany({ where: { orgId: config.orgId, enabled: true }, select: { name: true } }),
    ])

    const bindings: CapabilityBindings = {
      guardrails,
      tools: enabledSkills.map((s) => s.name),
      caseTypes: enabledCaseTypes.map((c) => c.type),
      knowledge: enabledKnowledge.map((k) => k.name),
    }

    await prisma.agentConfig.update({
      where: { id: config.id },
      data: { capabilityBindings: JSON.stringify(bindings) },
    })

    updated++
    console.log(`  ✓ ${config.orgId}/${config.id}`)
  }

  console.log(`\nDone: ${updated} updated, ${skipped} skipped (already have bindings).`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
