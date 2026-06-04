// C3 — Real-DB round-trip test for repoForOrg (G2 tenant isolation seam).
// Requires local PostgreSQL: docker compose up -d && npx prisma db push
// Skips automatically when DATABASE_URL doesn't point to localhost.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@intera/shared/prisma'
import { repoForOrg } from '@/lib/db/repo-for-org'

const DATABASE_URL = process.env.DATABASE_URL || ''
const hasLocalPostgres = DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1')

const TEST_ORG_A = `test-org-a-${Date.now()}`
const TEST_ORG_B = `test-org-b-${Date.now()}`

describe.skipIf(!hasLocalPostgres)('repoForOrg — real PostgreSQL round-trip', () => {
  beforeAll(async () => {
    await prisma.organization.createMany({
      data: [
        { id: TEST_ORG_A, name: 'Test Org A' },
        { id: TEST_ORG_B, name: 'Test Org B' },
      ],
      skipDuplicates: true,
    })
  })

  afterAll(async () => {
    await prisma.skill.deleteMany({
      where: { orgId: { in: [TEST_ORG_A, TEST_ORG_B] } },
    })
    await prisma.organization.deleteMany({
      where: { id: { in: [TEST_ORG_A, TEST_ORG_B] } },
    })
  })

  it('creates a skill with orgId injected by repoForOrg', async () => {
    const repo = repoForOrg(TEST_ORG_A)
    const created = await repo.skill.create({
      data: { name: 'test-skill', description: 'test', inputSchema: '{}', outputSchema: '{}' },
    })
    expect(created.orgId).toBe(TEST_ORG_A)
  })

  it('finds the created skill through repoForOrg (read filtering)', async () => {
    const repo = repoForOrg(TEST_ORG_A)
    const found = await repo.skill.findFirst({ where: { name: 'test-skill' } })
    expect(found).not.toBeNull()
    expect(found!.orgId).toBe(TEST_ORG_A)
  })

  it('blocks cross-org read: repoForOrg(A) cannot see org B skills', async () => {
    const repoB = repoForOrg(TEST_ORG_B)
    await repoB.skill.create({
      data: { name: 'org-b-skill', description: 'B', inputSchema: '{}', outputSchema: '{}' },
    })
    const repoA = repoForOrg(TEST_ORG_A)
    const crossRead = await repoA.skill.findFirst({ where: { name: 'org-b-skill' } })
    expect(crossRead).toBeNull()
  })

  it('upsert through repoForOrg injects orgId', async () => {
    const repo = repoForOrg(TEST_ORG_A)
    const upserted = await repo.skill.upsert({
      where: { orgId_name: { orgId: TEST_ORG_A, name: 'upserted-skill' } },
      create: { name: 'upserted-skill', description: 'via upsert', inputSchema: '{}', outputSchema: '{}' },
      update: { description: 'updated' },
    })
    expect(upserted.orgId).toBe(TEST_ORG_A)
  })

  it('raw prisma (no proxy) can see ALL skills across orgs', async () => {
    const allSkills = await prisma.skill.findMany({
      where: { orgId: { in: [TEST_ORG_A, TEST_ORG_B] } },
    })
    expect(allSkills.length).toBeGreaterThanOrEqual(2)
    const orgIds = new Set(allSkills.map((s) => s.orgId))
    expect(orgIds.has(TEST_ORG_A)).toBe(true)
    expect(orgIds.has(TEST_ORG_B)).toBe(true)
  })
})
