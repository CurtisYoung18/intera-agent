// D1 Login guard test — proves per-user email/password login works.
//
// RED (before D1):  only STAFF_PASSWORD login exists
// GREEN (after D1):  per-user email/password login with bcrypt

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hashSync } from 'bcryptjs'

const VALID_PASSWORD = 'test-password-123'
const VALID_HASH = hashSync(VALID_PASSWORD, 10)

// ── Hoisted mock state ──
const h = vi.hoisted(() => {
  const users: Record<string, { id: string; email: string; name: string; passwordHash: string; role: string; memberships: Array<{ orgId: string; role: string }> }> = {}
  const issuedTokens: Array<{ userId: string; orgId: string; role: string }> = []
  return { users, issuedTokens }
})

// ── Mock prisma ──
vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email: string } }) => {
        return h.users[where.email] ?? null
      }),
    },
  },
}))

// ── Mock rate-limit (always allow) ──
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 19, resetAt: Date.now() + 60000 })),
  clientIp: vi.fn(() => '127.0.0.1'),
}))

// ── Mock session signing ──
vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>()
  return {
    ...actual,
    SESSION_COOKIE: 'intera_session',
    SESSION_MAX_AGE_S: 604800,
    signSession: vi.fn(async (input: { userId: string; orgId: string; role: string }) => {
      h.issuedTokens.push(input)
      return `mock-token-${input.userId}-${input.orgId}`
    }),
  }
})

import { POST } from '@/app/api/auth/login/route'

function makeRequest(body: Record<string, unknown>) {
  return {
    json: async () => body,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.users['admin@test.com'] = {
    id: 'user-admin-1',
    email: 'admin@test.com',
    name: 'Test Admin',
    passwordHash: VALID_HASH,
    role: 'owner',
    memberships: [{ orgId: 'org-a', role: 'owner' }],
  }
  h.users['viewer@test.com'] = {
    id: 'user-viewer-1',
    email: 'viewer@test.com',
    name: 'Test Viewer',
    passwordHash: VALID_HASH,
    role: 'viewer',
    memberships: [{ orgId: 'org-a', role: 'viewer' }],
  }
  h.users['no-membership@test.com'] = {
    id: 'user-no-mem-1',
    email: 'no-membership@test.com',
    name: 'No Membership',
    passwordHash: VALID_HASH,
    role: 'operator',
    memberships: [],
  }
  h.issuedTokens.length = 0
})

describe('Login — valid credentials', () => {
  it('returns 200 with session for valid email + password', async () => {
    const req = makeRequest({ email: 'admin@test.com', password: VALID_PASSWORD })
    const res = await POST(req as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.userId).toBe('user-admin-1')
    expect(body.orgId).toBe('org-a')
    expect(body.role).toBe('owner')

    // Verify session cookie was set
    const cookieHeader = res.headers.get('set-cookie')
    expect(cookieHeader).toContain('intera_session=mock-token-user-admin-1-org-a')
  })

  it('uses primary membership (highest role) for session org', async () => {
    // User with multiple memberships — owner in org-b should be primary
    h.users['admin@test.com'] = {
      id: 'user-multi-1',
      email: 'admin@test.com',
      name: 'Multi-org Admin',
      passwordHash: VALID_HASH,
      role: 'viewer',
      memberships: [
        { orgId: 'org-a', role: 'viewer' },
        { orgId: 'org-b', role: 'owner' },
      ],
    }

    const req = makeRequest({ email: 'admin@test.com', password: VALID_PASSWORD })
    const res = await POST(req as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.orgId).toBe('org-b') // owner role wins
    expect(body.role).toBe('owner')
  })
})

describe('Login — invalid credentials', () => {
  it('returns 401 for wrong password', async () => {
    const req = makeRequest({ email: 'admin@test.com', password: 'wrong-password' })
    const res = await POST(req as any)

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Invalid email or password')
  })

  it('returns 401 for non-existent email', async () => {
    const req = makeRequest({ email: 'nobody@test.com', password: VALID_PASSWORD })
    const res = await POST(req as any)

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Invalid email or password')
  })

  it('returns 401 for user without passwordHash', async () => {
    h.users['admin@test.com'] = {
      ...h.users['admin@test.com'],
      passwordHash: '',
    }

    const req = makeRequest({ email: 'admin@test.com', password: VALID_PASSWORD })
    const res = await POST(req as any)

    expect(res.status).toBe(401)
  })

  it('returns 400 when email or password is missing', async () => {
    const req = makeRequest({ email: '', password: '' })
    const res = await POST(req as any)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Email and password are required')
  })
})

describe('Login — viewer role', () => {
  it('viewer can log in and gets viewer session', async () => {
    const req = makeRequest({ email: 'viewer@test.com', password: VALID_PASSWORD })
    const res = await POST(req as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.role).toBe('viewer')
    expect(body.userId).toBe('user-viewer-1')
  })
})

describe('Login — user with no membership', () => {
  it('denies login when user has no memberships', async () => {
    const req = makeRequest({ email: 'no-membership@test.com', password: VALID_PASSWORD })
    const res = await POST(req as any)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toContain('membership')
  })
})
