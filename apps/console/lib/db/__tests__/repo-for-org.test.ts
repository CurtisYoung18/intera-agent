// Dedicated repo-for-org unit test — exercises the tenant Proxy
// (scopedModel) directly with spy objects. No DB, no vitest module
// mocking. Asserts orgId injection for every wrapped method.
//
// Verifies Blocker 1 is closed:
//   - updateMany/deleteMany inject where.orgId
//   - createMany injects data.orgId into each element
//   - unwrapped methods (aggregate, groupBy, unknown) THROW

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { scopedModel } from '@/lib/db/repo-for-org'

const ORG = 'test-org-42'

function makeSpies() {
  return {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => null),
    findUniqueOrThrow: vi.fn(async () => ({})),
    findFirst: vi.fn(async () => null),
    findFirstOrThrow: vi.fn(async () => ({})),
    count: vi.fn(async () => 0),
    create: vi.fn(async (args: any) => args?.data),
    createMany: vi.fn(async () => ({ count: 0 })),
    update: vi.fn(async (args: any) => args?.data),
    updateMany: vi.fn(async () => ({ count: 0 })),
    upsert: vi.fn(async (args: any) => args?.create),
    delete: vi.fn(async () => ({})),
    deleteMany: vi.fn(async () => ({ count: 0 })),
    aggregate: vi.fn(async () => ({})),
    groupBy: vi.fn(async () => []),
    fields: { id: 'string' },
    name: 'Skill',
  }
}

let s: ReturnType<typeof makeSpies>
let model: ReturnType<typeof scopedModel>

beforeEach(() => {
  s = makeSpies()
  model = scopedModel(s as any, ORG)
})

// ── WHERE injection ──
describe('scopedModel — where injection', () => {
  it('findMany injects orgId into where', async () => {
    await model.findMany({ orderBy: { name: 'asc' } })
    expect(s.findMany).toHaveBeenCalledWith({
      orderBy: { name: 'asc' },
      where: { orgId: ORG },
    })
  })

  it('findMany with existing where merges orgId', async () => {
    await model.findMany({ where: { enabled: true } })
    expect(s.findMany).toHaveBeenCalledWith({
      where: { enabled: true, orgId: ORG },
    })
  })

  it('findMany with no args injects orgId-only where', async () => {
    await model.findMany()
    expect(s.findMany).toHaveBeenCalledWith({ where: { orgId: ORG } })
  })

  it('findFirst injects orgId into where', async () => {
    await model.findFirst({ where: { name: 'test' } })
    expect(s.findFirst).toHaveBeenCalledWith({
      where: { name: 'test', orgId: ORG },
    })
  })

  it('findFirstOrThrow injects orgId into where', async () => {
    await model.findFirstOrThrow({ where: { name: 'test' } })
    expect(s.findFirstOrThrow).toHaveBeenCalledWith({
      where: { name: 'test', orgId: ORG },
    })
  })

  it('count injects orgId into where', async () => {
    await model.count({ where: { enabled: true } })
    expect(s.count).toHaveBeenCalledWith({
      where: { enabled: true, orgId: ORG },
    })
  })

  it('findUnique injects orgId when not in compound key', async () => {
    await model.findUnique({ where: { name: 'test' } })
    expect(s.findUnique).toHaveBeenCalledWith({
      where: { name: 'test', orgId: ORG },
    })
  })

  it('findUnique preserves explicit orgId in compound key', async () => {
    await model.findUnique({
      where: { orgId_name: { orgId: 'explicit', name: 'test' } },
    })
    expect(s.findUnique).toHaveBeenCalledWith({
      where: { orgId_name: { orgId: 'explicit', name: 'test' } },
    })
  })

  it('findUniqueOrThrow injects orgId', async () => {
    await model.findUniqueOrThrow({ where: { name: 'test' } })
    expect(s.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { name: 'test', orgId: ORG },
    })
  })
})

// ── DATA injection ──
describe('scopedModel — data injection', () => {
  it('create injects orgId into data', async () => {
    await model.create({ data: { name: 'new-skill' } })
    expect(s.create).toHaveBeenCalledWith({
      data: { name: 'new-skill', orgId: ORG },
    })
  })
})

// ── update / delete ──
describe('scopedModel — update / delete', () => {
  it('update injects orgId into where, preserves data', async () => {
    await model.update({ where: { id: 'sk1' }, data: { name: 'renamed' } })
    expect(s.update).toHaveBeenCalledWith({
      where: { id: 'sk1', orgId: ORG },
      data: { name: 'renamed' },
    })
  })

  it('delete injects orgId into where', async () => {
    await model.delete({ where: { id: 'sk1' } })
    expect(s.delete).toHaveBeenCalledWith({
      where: { id: 'sk1', orgId: ORG },
    })
  })
})

// ── upsert ──
describe('scopedModel — upsert', () => {
  it('upsert injects orgId into create when where has explicit orgId', async () => {
    await model.upsert({
      where: { orgId_name: { orgId: ORG, name: 'test' } },
      create: { name: 'test', description: 'desc' },
      update: { description: 'updated' },
    })
    expect(s.upsert).toHaveBeenCalledWith({
      where: { orgId_name: { orgId: ORG, name: 'test' } },
      create: { name: 'test', description: 'desc', orgId: ORG },
      update: { description: 'updated' },
    })
  })

  it('upsert auto-injects orgId into where when missing', async () => {
    await model.upsert({
      where: { name: 'test' } as any,
      create: { name: 'test' },
      update: {},
    })
    expect(s.upsert).toHaveBeenCalledWith({
      where: { name: 'test', orgId: ORG },
      create: { name: 'test', orgId: ORG },
      update: {},
    })
  })
})

// ── BLOCKER 1: updateMany / deleteMany inject where.orgId ──
describe('scopedModel — updateMany / deleteMany (Blocker 1 fix)', () => {
  it('updateMany injects orgId into where', async () => {
    await model.updateMany({ where: { enabled: false }, data: { enabled: true } })
    expect(s.updateMany).toHaveBeenCalledWith({
      where: { enabled: false, orgId: ORG },
      data: { enabled: true },
    })
  })

  it('deleteMany injects orgId into where', async () => {
    await model.deleteMany({ where: { name: 'stale' } })
    expect(s.deleteMany).toHaveBeenCalledWith({
      where: { name: 'stale', orgId: ORG },
    })
  })
})

// ── BLOCKER 1: createMany injects data.orgId ──
describe('scopedModel — createMany (Blocker 1 fix)', () => {
  it('createMany injects orgId into each data element', async () => {
    await model.createMany({ data: [{ name: 'a' }, { name: 'b' }] })
    expect(s.createMany).toHaveBeenCalledWith({
      data: [
        { name: 'a', orgId: ORG },
        { name: 'b', orgId: ORG },
      ],
    })
  })
})

// ── BLOCKER 1: unwrapped methods THROW ──
describe('scopedModel — unwrapped methods THROW (Blocker 1 fix)', () => {
  it('aggregate throws (not org-scoped)', () => {
    expect(() => model.aggregate({ where: {} })).toThrow(
      'repoForOrg: "aggregate" is not org-scoped',
    )
  })

  it('groupBy throws (not org-scoped)', () => {
    expect(() => model.groupBy({ by: ['name'] })).toThrow(
      'repoForOrg: "groupBy" is not org-scoped',
    )
  })

  it('unknown method throws', () => {
    expect(() => (model as any).someUnknownMethod()).toThrow(
      'repoForOrg: "someUnknownMethod" is not org-scoped',
    )
  })
})

// ── Non-function properties pass through ──
describe('scopedModel — non-function properties', () => {
  it('non-function properties pass through untouched', () => {
    expect(model.fields).toEqual({ id: 'string' })
  })

  it('name property passes through', () => {
    expect(model.name).toBe('Skill')
  })
})
