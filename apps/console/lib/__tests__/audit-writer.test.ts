// Audit-writer seam test — proves writeAudit is callable from BOTH
// defineRoute (HTTP routes) and directly (agent runtime = policy.ts/loop.ts).
//
// RED→GREEN: before this seam, defineRoute's audit() was a no-op console.log
// and the agent runtime had no way to write AuditLog rows at all.
// After: both paths write a real prisma.auditLog.create row.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mock state ──
const h = vi.hoisted(() => {
  const auditLogCreates: Array<{
    data: {
      actorUserId: string
      orgId: string
      action: string
      target: string
      before?: unknown
      after?: unknown
    }
  }> = []

  const mockGetSession = vi.fn()
  const mockPrismaCreate = vi.fn(async (args: any) => {
    auditLogCreates.push(args)
    return { id: `audit_${auditLogCreates.length}`, ...args.data, createdAt: new Date() }
  })

  return { auditLogCreates, mockGetSession, mockPrismaCreate }
})

// ── Mock auth — defineRoute's resolveSession() calls getSession() ──
vi.mock('@/lib/auth', () => ({
  getSession: h.mockGetSession,
}))

// ── Mock prisma — the writeAudit seam writes via prisma.auditLog.create ──
vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    auditLog: {
      create: (args: any) => h.mockPrismaCreate(args),
    },
  },
}))

// ── Mock repoForOrg (defineRoute depends on it) ──
vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    return {
      orgId,
      skill: { findMany: vi.fn(async () => []) },
      raw: {
        organization: { upsert: vi.fn(async () => ({ id: orgId, name: 'Test Org' })) },
      },
    }
  },
  scopedModel: vi.fn(),
}))

// ── Mock logger (silent in tests) ──
vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { writeAudit } from '@/lib/audit'
import { NextRequest } from 'next/server'

describe('writeAudit (shared audit-writer seam)', () => {
  beforeEach(() => {
    h.auditLogCreates.length = 0
    h.mockPrismaCreate.mockClear()
    h.mockGetSession.mockClear()
  })

  it('Path A — direct writeAudit() writes an AuditLog row (agent-runtime path)', async () => {
    await writeAudit({
      actorUserId: 'user_abc',
      orgId: 'org_xyz',
      action: 'guardrail.escalate',
      target: 'hook:no_compensation_promise',
      before: { skill: 'refund_money' },
      after: { verdict: 'escalated' },
    })

    expect(h.auditLogCreates).toHaveLength(1)
    const call = h.auditLogCreates[0].data
    expect(call.actorUserId).toBe('user_abc')
    expect(call.orgId).toBe('org_xyz')
    expect(call.action).toBe('guardrail.escalate')
    expect(call.target).toBe('hook:no_compensation_promise')
    expect(call.before).toEqual({ skill: 'refund_money' })
    expect(call.after).toEqual({ verdict: 'escalated' })
  })

  it('Path A — writeAudit does not throw on DB failure (audit is non-blocking)', async () => {
    h.mockPrismaCreate.mockRejectedValueOnce(new Error('DB connection lost'))

    await expect(
      writeAudit({
        actorUserId: 'u1',
        orgId: 'o1',
        action: 'test',
        target: 'test',
      }),
    ).resolves.toBeUndefined()
  })

  it('Path B — defineRoute audit() writes an AuditLog row via writeAudit (HTTP path)', async () => {
    const { defineRoute } = await import('@/lib/api/define-route')

    h.mockGetSession.mockResolvedValue({
      orgId: 'org_xyz',
      role: 'admin',
      userId: 'user_abc',
    })

    const route = defineRoute({
      method: 'POST',
      handler: async (ctx) => {
        await ctx.audit({
          action: 'skill.create',
          target: 'skill:my_tool',
          after: { name: 'my_tool' },
        })
        return { ok: true as const, data: { done: true } }
      },
    })

    const req = new NextRequest('http://localhost/api/test', { method: 'POST' })
    const res = await route(req)

    // Verify response has x-request-id header
    expect(res.headers.get('x-request-id')).toBeTruthy()
    expect(res.headers.get('x-request-id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )

    // Verify audit row was written
    expect(h.auditLogCreates).toHaveLength(1)
    const call = h.auditLogCreates[0].data
    expect(call.actorUserId).toBe('user_abc')
    expect(call.orgId).toBe('org_xyz')
    expect(call.action).toBe('skill.create')
    expect(call.target).toBe('skill:my_tool')
    expect(call.after).toEqual({ name: 'my_tool' })
  })

  it('x-request-id is set on error responses too', async () => {
    const { defineRoute, UnauthorizedError } = await import('@/lib/api/define-route')

    h.mockGetSession.mockResolvedValue({
      orgId: 'org_xyz',
      role: 'admin',
      userId: 'user_abc',
    })

    const route = defineRoute({
      method: 'GET',
      handler: async () => {
        throw new UnauthorizedError('no access')
      },
    })

    const req = new NextRequest('http://localhost/api/test')
    const res = await route(req)

    expect(res.headers.get('x-request-id')).toBeTruthy()
    expect(res.status).toBe(401)

    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('unauthorized')
  })

  it('x-request-id is set on 500 responses', async () => {
    const { defineRoute } = await import('@/lib/api/define-route')

    h.mockGetSession.mockResolvedValue({
      orgId: 'org_xyz',
      role: 'admin',
      userId: 'user_abc',
    })

    const route = defineRoute({
      method: 'GET',
      handler: async () => {
        throw new Error('boom')
      },
    })

    const req = new NextRequest('http://localhost/api/test')
    const res = await route(req)

    expect(res.headers.get('x-request-id')).toBeTruthy()
    expect(res.status).toBe(500)

    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('internal')
  })
})
