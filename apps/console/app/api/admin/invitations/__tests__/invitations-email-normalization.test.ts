// Invitations email normalization test — proves createInviteSchema lowercases + trims.
//
// RED (before Task 1a):  raw email stored, case-duplicates possible
// GREEN (after Task 1a): emailNormalized applied, duplicates blocked

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mock state ──
const h = vi.hoisted(() => {
  const invitations: Array<{
    id: string
    email: string | null
    orgId: string
    invitedBy: string
    role: string
    token: string
    state: string
    maxUses: number | null
    useCount: number
    expiresAt: Date
  }> = []
  const memberships: Array<{ orgId: string; userId: string; userEmail: string; role: string }> = []
  let nextId = 0
  return { invitations, memberships, nextId }
})

// ── Mock logger (defineRoute dependency) ──
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ── Mock auth (so defineRoute resolves session) ──
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => ({
    orgId: 'org-a',
    role: 'admin',
    userId: 'user-admin-1',
  })),
}))

// ── Mock prisma (Proxy so repoForOrg can access any model) ──
vi.mock('@intera/shared/prisma', () => ({
  prisma: new Proxy(
    {
      invitation: {
        findFirst: vi.fn(async (args: any) => {
          const { where } = args
          return (
            h.invitations.find((i) => {
              if (where.email !== undefined && i.email !== where.email) return false
              if (where.orgId !== undefined && i.orgId !== where.orgId) return false
              if (where.state !== undefined && i.state !== where.state) return false
              if (where.token !== undefined && i.token !== where.token) return false
              return true
            }) ?? null
          )
        }),
        findMany: vi.fn(async (args: any) => {
          const { where } = args
          return h.invitations.filter((i) => {
            if (where.email !== undefined && i.email !== where.email) return false
            if (where.orgId !== undefined && i.orgId !== where.orgId) return false
            if (where.state !== undefined && i.state !== where.state) return false
            return true
          })
        }),
        create: vi.fn(async (args: any) => {
          const invitation = {
            id: `inv-${++h.nextId}`,
            email: args.data.email,
            orgId: args.data.orgId,
            invitedBy: args.data.invitedBy,
            role: args.data.role,
            token: args.data.token,
            state: args.data.state,
            maxUses: args.data.maxUses ?? null,
            useCount: args.data.useCount ?? 0,
            expiresAt: args.data.expiresAt,
            inviter: args.include?.inviter
              ? { email: 'admin@org-a.com', name: 'Admin' }
              : undefined,
          }
          h.invitations.push(invitation)
          return invitation
        }),
      },
      membership: {
        findFirst: vi.fn(async (args: any) => {
          const { where } = args
          // For scoped model: where may have { role, orgId }
          // For raw: where may have { orgId, user: { email } }
          const userEmail = where?.user?.email
          if (userEmail) {
            return (
              h.memberships.find(
                (m) => m.orgId === where.orgId && m.userEmail === userEmail,
              ) ?? null
            )
          }
          return (
            h.memberships.find((m) => {
              if (where.role !== undefined && m.role !== where.role) return false
              if (where.orgId !== undefined && m.orgId !== where.orgId) return false
              return true
            }) ?? null
          )
        }),
      },
    },
    {
      get(target, prop) {
        if (typeof prop === 'symbol') return undefined
        return (target as any)[prop] ?? {}
      },
    },
  ),
}))

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/admin/invitations/route'

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/invitations', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.invitations.length = 0
  h.memberships.length = 0
  h.nextId = 0
})

describe('Invitations — email normalization', () => {
  it('stores mixed-case email as lowercase', async () => {
    const req = makeRequest({ email: 'Mixed@Case.COM', role: 'operator' })
    const res = await (POST as any)(req)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.ok).toBe(true)

    // Verify the persisted invitation has normalized email
    expect(h.invitations).toHaveLength(1)
    expect(h.invitations[0].email).toBe('mixed@case.com')
  })

  it('stores already-lowercase email unchanged', async () => {
    const req = makeRequest({ email: 'normal@test.com', role: 'viewer' })
    const res = await (POST as any)(req)

    expect(res.status).toBe(201)
    expect(h.invitations).toHaveLength(1)
    expect(h.invitations[0].email).toBe('normal@test.com')
  })

  it('trims whitespace from email', async () => {
    const req = makeRequest({ email: '  spaced@test.com  ', role: 'operator' })
    const res = await (POST as any)(req)

    expect(res.status).toBe(201)
    expect(h.invitations).toHaveLength(1)
    expect(h.invitations[0].email).toBe('spaced@test.com')
  })
})

describe('Invitations — case-duplicate detection', () => {
  it('returns 409 when creating an invite with case-variant of existing email', async () => {
    // First invite: lowercase
    const req1 = makeRequest({ email: 'a@x.com', role: 'operator' })
    const res1 = await (POST as any)(req1)
    expect(res1.status).toBe(201)

    // Second invite: same email, different case — must be 409 Conflict
    const req2 = makeRequest({ email: 'A@x.com', role: 'viewer' })
    const res2 = await (POST as any)(req2)
    const body2 = await res2.json()

    expect(res2.status).toBe(409)
    expect(body2.ok).toBe(false)
    expect(body2.error.message).toBe('A pending invitation already exists for this email')

    // Only one invitation should exist
    expect(h.invitations).toHaveLength(1)
  })

  it('returns 409 when creating an invite for an existing member (case-variant)', async () => {
    // Add an existing member
    h.memberships.push({
      orgId: 'org-a',
      userId: 'user-existing-1',
      userEmail: 'member@test.com',
      role: 'viewer',
    })

    const req = makeRequest({ email: 'MEMBER@test.com', role: 'operator' })
    const res = await (POST as any)(req)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.ok).toBe(false)
    expect(body.error.message).toBe('User is already a member of this organization')

    // No invitation should be created
    expect(h.invitations).toHaveLength(0)
  })
})
