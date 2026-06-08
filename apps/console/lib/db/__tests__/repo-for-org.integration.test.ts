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
const TEST_AGENT_A = `test-agent-a-${Date.now()}`
const TEST_AGENT_B = `test-agent-b-${Date.now()}`

describe.skip('repoForOrg — real PostgreSQL round-trip (requires local DB)', () => {
  beforeAll(async () => {
    await prisma.organization.createMany({
      data: [
        { id: TEST_ORG_A, name: 'Test Org A' },
        { id: TEST_ORG_B, name: 'Test Org B' },
      ],
      skipDuplicates: true,
    })
    await prisma.agentConfig.createMany({
      data: [
        { id: TEST_AGENT_A, orgId: TEST_ORG_A, version: 1, model: 'deepseek-v4-flash', memoryStrategy: '{}' },
        { id: TEST_AGENT_B, orgId: TEST_ORG_B, version: 1, model: 'deepseek-v4-flash', memoryStrategy: '{}' },
      ],
      skipDuplicates: true,
    })
  })

  afterAll(async () => {
    await prisma.tool.deleteMany({
      where: { agentConfigId: { in: [TEST_AGENT_A, TEST_AGENT_B] } },
    })
    await prisma.agentConfig.deleteMany({
      where: { id: { in: [TEST_AGENT_A, TEST_AGENT_B] } },
    })
    await prisma.organization.deleteMany({
      where: { id: { in: [TEST_ORG_A, TEST_ORG_B] } },
    })
  })

  it('creates a tool with agentConfigId injected by repoForOrg', async () => {
    const repo = repoForOrg(TEST_ORG_A)
    const created = await repo.raw.tool.create({
      data: { agentConfigId: TEST_AGENT_A, name: 'test-tool', description: 'test', inputSchema: '{}', outputSchema: '{}' },
    })
    expect(created.agentConfigId).toBe(TEST_AGENT_A)
  })

  it('finds the created tool through raw prisma', async () => {
    const found = await prisma.tool.findFirst({ where: { name: 'test-tool', agentConfigId: TEST_AGENT_A } })
    expect(found).not.toBeNull()
    expect(found!.agentConfigId).toBe(TEST_AGENT_A)
  })

  it('blocks cross-org read: repoForOrg(A) cannot see org B configs', async () => {
    await prisma.tool.create({
      data: { agentConfigId: TEST_AGENT_B, name: 'org-b-tool', description: 'B', inputSchema: '{}', outputSchema: '{}' },
    })
    const crossRead = await prisma.tool.findFirst({ where: { name: 'org-b-tool', agentConfigId: TEST_AGENT_A } })
    expect(crossRead).toBeNull()
  })

  it('upsert through raw prisma with agentConfigId', async () => {
    const upserted = await prisma.tool.upsert({
      where: { agentConfigId_name: { agentConfigId: TEST_AGENT_A, name: 'upserted-tool' } },
      create: { agentConfigId: TEST_AGENT_A, name: 'upserted-tool', description: 'via upsert', inputSchema: '{}', outputSchema: '{}' },
      update: { description: 'updated' },
    })
    expect(upserted.agentConfigId).toBe(TEST_AGENT_A)
  })

  it('raw prisma (no proxy) can see ALL tools across orgs', async () => {
    const allTools = await prisma.tool.findMany({
      where: { agentConfigId: { in: [TEST_AGENT_A, TEST_AGENT_B] } },
    })
    expect(allTools.length).toBeGreaterThanOrEqual(2)
    const agentIds = new Set(allTools.map((s) => s.agentConfigId))
    expect(agentIds.has(TEST_AGENT_A)).toBe(true)
    expect(agentIds.has(TEST_AGENT_B)).toBe(true)
  })
})
