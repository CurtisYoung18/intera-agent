// D2 Google SSO + invite-only isolation guard test.
//
// Proves that:
//  1. Valid id_token + matching pending Invitation → creates User+Membership, session issued
//  2. Valid id_token WITHOUT matching Invitation AND no Membership → 403 denied
//  3. Valid id_token with existing User.googleSub match → logs in (no invitation needed)
//  4. Invalid state parameter → CSRF rejected
//  5. Token with email_verified=false → rejected
//  6. Expired token → rejected
//  7. Wrong audience token → rejected

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Types for hoisted state ──
type UserRecord = { id: string; email: string; name: string | null; googleSub: string | null; passwordHash: string | null }
type MembershipRecord = { id: string; userId: string; orgId: string; role: string }
type InvitationRecord = { id: string; email: string | null; orgId: string; invitedBy: string; role: string; token: string; state: string; expiresAt: Date; maxUses?: number; useCount?: number }
type TokenRecord = { userId: string; orgId: string; role: string }
type ClaimsRecord = { sub: string; email: string; email_verified: boolean; name?: string }

interface HoistedState {
  users: Record<string, UserRecord>
  memberships: MembershipRecord[]
  invitations: Record<string, InvitationRecord>
  issuedTokens: TokenRecord[]
  mockClaims: ClaimsRecord | null
  mockVerifyError: Error | null
  mockCsrfState: string | null
}

// ── Test state (hoisted so mocks can reference it) ──
const h = vi.hoisted(() => {
  return {
    users: {} as Record<string, UserRecord>,
    memberships: [] as MembershipRecord[],
    invitations: {} as Record<string, InvitationRecord>,
    issuedTokens: [] as TokenRecord[],
    mockClaims: null as ClaimsRecord | null,
    mockVerifyError: null as Error | null,
    mockCsrfState: 'valid-csrf-state' as string | null,
  } satisfies HoistedState
})

// ── Helper to generate unique IDs ──
let idCounter = 0
function cuid(): string {
  return `test-${++idCounter}-${Date.now()}`
}

// ── Mock logger ──
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

// ── Mock prisma (Proxy with fallback {} so repoForOrg can access any model) ──
vi.mock('@intera/shared/prisma', () => ({
  prisma: new Proxy({
    user: {
      findUnique: vi.fn(async (args: { where: Record<string, unknown>; include?: Record<string, unknown> }) => {
        const where = args.where
        // Lookup by googleSub
        if (where.googleSub) {
          const found = Object.values(h.users).find((u) => u.googleSub === where.googleSub)
          if (!found) return null
          const userMemberships = h.memberships.filter((m) => m.userId === found.id)
          return { ...found, memberships: userMemberships.map((m) => ({ orgId: m.orgId, role: m.role })) }
        }
        // Lookup by email
        if (where.email) {
          const found = h.users[where.email as string]
          if (!found) return null
          const userMemberships = h.memberships.filter((m) => m.userId === found.id)
          return { ...found, memberships: userMemberships.map((m) => ({ orgId: m.orgId, role: m.role })) }
        }
        return null
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const user = Object.values(h.users).find((u) => u.id === args.where.id)
        if (!user) throw new Error('User not found')
        Object.assign(user, args.data)
        return user
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const newUser = { id: cuid(), ...args.data } as typeof h.users[string]
        h.users[newUser.email] = newUser
        return newUser
      }),
    },
    membership: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const m = { id: cuid(), ...args.data } as (typeof h.memberships)[number]
        h.memberships.push(m)
        return m
      }),
      findUnique: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const where = args.where
        if (where.userId_orgId) {
          return h.memberships.find(
            (m) => m.userId === (where.userId_orgId as any).userId && m.orgId === (where.userId_orgId as any).orgId,
          ) ?? null
        }
        return null
      }),
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const userId = args.where.userId as string
        return h.memberships
          .filter((m) => m.userId === userId)
          .map((m) => ({ orgId: m.orgId, role: m.role }))
      }),
    },
    invitation: {
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const where = args.where
        return Object.values(h.invitations).filter((inv) => {
          if (where.email && inv.email !== where.email) return false
          if (where.state && inv.state !== where.state) return false
          if (inv.expiresAt <= new Date()) return false
          return true
        })
      }),
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const where = args.where
        for (const inv of Object.values(h.invitations)) {
          if (inv.email !== where.email) continue
          if (where.state && inv.state !== where.state) continue
          if (inv.expiresAt <= new Date()) continue
          return inv
        }
        return null
      }),
      findUnique: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const where = args.where
        if (where.token) {
          return Object.values(h.invitations).find((inv) => inv.token === where.token) ?? null
        }
        return null
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const inv = h.invitations[args.where.id]
        if (!inv) throw new Error('Invitation not found')
        Object.assign(inv, args.data)
        return inv
      }),
    },
    // Mock $transaction to run the callback against the mock stores
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: {
          create: async (args: { data: Record<string, unknown> }) => {
            const newUser = { id: cuid(), ...args.data } as typeof h.users[string]
            h.users[newUser.email] = newUser
            return newUser
          },
        },
        membership: {
          create: async (args: { data: Record<string, unknown> }) => {
            const m = { id: cuid(), ...args.data } as (typeof h.memberships)[number]
            h.memberships.push(m)
            return m
          },
        },
        invitation: {
          update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
            const inv = h.invitations[args.where.id]
            if (!inv) throw new Error('Invitation not found')
            Object.assign(inv, args.data)
            return inv
          },
        },
      }
      return cb(tx)
    }),
  }, {
    get(target, prop) {
      if (typeof prop === 'symbol') return undefined
      return (target as any)[prop] ?? {}
    },
  }),
}))

// ── Mock session ──
vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>()
  return {
    ...actual,
    SESSION_COOKIE: 'intera_session',
    SESSION_MAX_AGE_S: 604800,
    signSession: vi.fn(async (input: { userId: string; orgId: string; role: string }) => {
      h.issuedTokens.push(input)
      return `mock-token-${input.userId}-${input.orgId}-${input.role}`
    }),
  }
})

// ── Mock auth (defineRoute import chain) ──
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(), getActiveOrgId: vi.fn(), getActiveVendor: vi.fn() }))
vi.mock('@/lib/api-auth', () => ({ resolveOrgFromApiKey: vi.fn(), isTrustedInternalCall: vi.fn() }))

// ── Mock Google auth layer ──
vi.mock('@/lib/auth/google', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/google')>()
  return {
    ...actual,
    exchangeCodeForTokens: vi.fn(async (_code: string) => {
      if (h.mockVerifyError) throw h.mockVerifyError
      return {
        id_token: 'mock-google-id-token',
        access_token: 'mock-access-token',
        expires_in: 3600,
        token_type: 'Bearer',
      }
    }),
    verifyGoogleIdToken: vi.fn(async (_idToken: string) => {
      if (h.mockVerifyError) throw h.mockVerifyError
      if (!h.mockClaims) {
        throw new Error('mockClaims not configured')
      }
      return {
        sub: h.mockClaims.sub,
        email: h.mockClaims.email,
        email_verified: h.mockClaims.email_verified,
        name: h.mockClaims.name,
        picture: undefined,
        iss: 'https://accounts.google.com',
        aud: 'mock-client-id.apps.googleusercontent.com',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      }
    }),
    getCsrfStateCookie: vi.fn(async () => h.mockCsrfState),
    clearCsrfStateCookie: vi.fn(() => {}),
    setCsrfStateCookie: vi.fn(async () => 'mock-state-value'),
  }
})

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/auth/google/callback/route'

// ── Helpers ──

function makeCallbackRequest(params: Record<string, string>) {
  const url = new URL('http://localhost:3001/api/auth/google/callback')
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return new NextRequest(url.toString())
}

function getLocation(res: Response): string | null {
  return res.headers.get('location')
}

function getSetCookie(res: Response): string | null {
  return res.headers.get('set-cookie')
}

beforeEach(() => {
  vi.clearAllMocks()
  // Reset stores
  Object.keys(h.users).forEach((k) => delete h.users[k])
  h.memberships.length = 0
  Object.keys(h.invitations).forEach((k) => delete h.invitations[k])
  h.issuedTokens.length = 0
  idCounter = 0

  // Default: successful token verification
  h.mockClaims = {
    sub: 'google-sub-123',
    email: 'test@example.com',
    email_verified: true,
    name: 'Test User',
  }
  h.mockVerifyError = null
  h.mockCsrfState = 'valid-csrf-state'

  // Set env vars for session
  process.env.SESSION_SECRET = 'test-session-secret-at-least-16-chars-long'
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3001'
})

// ════════════════════════════════════════════════════════════════
// Scenario 1: Valid id_token + matching pending Invitation
// ════════════════════════════════════════════════════════════════
describe('Scenario 1: Invitation-only registration via Google SSO', () => {
  beforeEach(() => {
    // Create a pending invitation
    h.invitations['inv-001'] = {
      id: 'inv-001',
      email: 'test@example.com',
      orgId: 'org-acme',
      invitedBy: 'owner-1',
      role: 'operator',
      token: 'token-abc',
      state: 'pending',
      expiresAt: new Date(Date.now() + 86400000), // 24h from now
    }
  })

  it('creates User + Membership, marks invitation accepted, issues session, redirects to /build/release', async () => {
    const req = makeCallbackRequest({ code: 'auth-code-1', state: 'valid-csrf-state' })
    const res = await GET(req as any)

    // Check redirect to guide
    expect(res.status).toBe(307) // App Router redirect uses 307
    const location = getLocation(res)
    expect(location).toBe('http://localhost:3001/build/release')

    // Check session cookie is set
    const cookie = getSetCookie(res)
    expect(cookie).toBeTruthy()
    expect(cookie).toContain('intera_session=mock-token-')

    // Check user was created
    const user = h.users['test@example.com']
    expect(user).toBeTruthy()
    expect(user.email).toBe('test@example.com')
    expect(user.googleSub).toBe('google-sub-123')
    expect(user.name).toBe('Test User')

    // Check membership was created
    const membership = h.memberships.find((m) => m.userId === user.id)
    expect(membership).toBeTruthy()
    expect(membership!.orgId).toBe('org-acme')
    expect(membership!.role).toBe('operator')

    // Check invitation was marked accepted
    const invitation = h.invitations['inv-001']
    expect(invitation.state).toBe('accepted')

    // Check session token was issued
    expect(h.issuedTokens.length).toBe(1)
    expect(h.issuedTokens[0].userId).toBe(user.id)
    expect(h.issuedTokens[0].orgId).toBe('org-acme')
    expect(h.issuedTokens[0].role).toBe('operator')
  })
})

// ════════════════════════════════════════════════════════════════
// Scenario 2: Valid id_token WITHOUT matching Invitation AND no Membership → 403 denied
// ════════════════════════════════════════════════════════════════
describe('Scenario 2: Google SSO denied without invitation', () => {
  it('returns error redirect when no invitation exists and no user exists', async () => {
    // No user, no invitation
    h.mockClaims = {
      sub: 'google-sub-unknown',
      email: 'stranger@example.com',
      email_verified: true,
      name: 'Stranger',
    }

    const req = makeCallbackRequest({ code: 'auth-code-2', state: 'valid-csrf-state' })
    const res = await GET(req as any)

    // Should redirect to login with error
    expect(res.status).toBe(307)
    const location = getLocation(res)
    expect(location).toContain('/login')
    expect(location).toContain('error=')
    // No session cookie should be set (no Set-Cookie header with intera_session)
    const cookie = getSetCookie(res)
    // May have CSRF clear cookie but NOT intera_session
    if (cookie) {
      expect(cookie).not.toContain('intera_session')
    } else {
      expect(cookie).toBeFalsy()
    }

    // No user should have been created
    expect(h.users['stranger@example.com']).toBeUndefined()
    expect(h.issuedTokens.length).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════
// Scenario 3: Valid id_token with existing User.googleSub match → logs in
// ════════════════════════════════════════════════════════════════
describe('Scenario 3: Existing user logs in via Google (googleSub match)', () => {
  beforeEach(() => {
    // Create an existing user with googleSub
    h.users['returning@example.com'] = {
      id: 'user-returning-1',
      email: 'returning@example.com',
      name: 'Returning User',
      googleSub: 'google-sub-123',
      passwordHash: null,
    }
    h.memberships.push({
      id: 'mem-returning',
      userId: 'user-returning-1',
      orgId: 'org-acme',
      role: 'admin',
    })
  })

  it('signs session and redirects to /build/release for existing user', async () => {
    h.mockClaims = {
      sub: 'google-sub-123',
      email: 'returning@example.com',
      email_verified: true,
      name: 'Returning User',
    }

    const req = makeCallbackRequest({ code: 'auth-code-3', state: 'valid-csrf-state' })
    const res = await GET(req as any)

    expect(res.status).toBe(307)
    const location = getLocation(res)
    expect(location).toBe('http://localhost:3001/build/release')

    // Session issued
    expect(h.issuedTokens.length).toBe(1)
    expect(h.issuedTokens[0].userId).toBe('user-returning-1')
    expect(h.issuedTokens[0].orgId).toBe('org-acme')
    expect(h.issuedTokens[0].role).toBe('admin')

    const cookie = getSetCookie(res)
    expect(cookie).toContain('intera_session=mock-token-')
    expect(cookie).toContain('user-returning-1')
  })

  it('redirects to org-picker when user has multiple memberships', async () => {
    // Add another membership
    h.memberships.push({
      id: 'mem-returning-2',
      userId: 'user-returning-1',
      orgId: 'org-beta',
      role: 'viewer',
    })

    const req = makeCallbackRequest({ code: 'auth-code-3b', state: 'valid-csrf-state' })
    const res = await GET(req as any)

    expect(res.status).toBe(307)
    const location = getLocation(res)
    expect(location).toBe('http://localhost:3001/org-picker')

    // Session issued with primary (highest role) org
    expect(h.issuedTokens.length).toBe(1)
    expect(h.issuedTokens[0].orgId).toBe('org-acme') // admin > viewer
    expect(h.issuedTokens[0].role).toBe('admin')
  })
})

// ════════════════════════════════════════════════════════════════
// Scenario 4: Invalid state parameter → CSRF rejected
// ════════════════════════════════════════════════════════════════
describe('Scenario 4: CSRF state validation', () => {
  it('rejects when state does not match CSRF cookie', async () => {
    // CSRF cookie returns 'valid-csrf-state' but request has 'attacker-state'
    h.mockCsrfState = 'valid-csrf-state'

    const req = makeCallbackRequest({ code: 'auth-code-4', state: 'attacker-state' })
    const res = await GET(req as any)

    expect(res.status).toBe(307)
    const location = getLocation(res)
    expect(location).toContain('/login')
    expect(location).toContain('error=')

    // No session issued, no user created
    expect(h.issuedTokens.length).toBe(0)
  })

  it('rejects when CSRF cookie is missing (null)', async () => {
    h.mockCsrfState = null

    const req = makeCallbackRequest({ code: 'auth-code-4b', state: 'any-state' })
    const res = await GET(req as any)

    expect(res.status).toBe(307)
    const location = getLocation(res)
    expect(location).toContain('/login')
    expect(location).toContain('error=')

    expect(h.issuedTokens.length).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════
// Scenario 5: Token with email_verified=false → rejected
// ════════════════════════════════════════════════════════════════
describe('Scenario 5: Reject unverified email', () => {
  it('rejects id_token where email_verified is false', async () => {
    h.mockVerifyError = new Error('Google account email is not verified')

    const req = makeCallbackRequest({ code: 'auth-code-5', state: 'valid-csrf-state' })
    const res = await GET(req as any)

    expect(res.status).toBe(307)
    const location = getLocation(res)
    expect(location).toContain('/login')
    expect(location).toContain('error=')

    // No session, no user created
    expect(h.issuedTokens.length).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════
// Scenario 6: Expired token → rejected
// ════════════════════════════════════════════════════════════════
describe('Scenario 6: Reject expired token', () => {
  it('rejects expired id_token', async () => {
    h.mockVerifyError = new Error('id_token has expired')

    const req = makeCallbackRequest({ code: 'auth-code-6', state: 'valid-csrf-state' })
    const res = await GET(req as any)

    expect(res.status).toBe(307)
    const location = getLocation(res)
    expect(location).toContain('/login')
    expect(location).toContain('error=')

    expect(h.issuedTokens.length).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════
// Scenario 7: Wrong audience token → rejected
// ════════════════════════════════════════════════════════════════
describe('Scenario 7: Reject wrong audience token', () => {
  it('rejects id_token with mismatched audience', async () => {
    h.mockVerifyError = new Error('id_token aud mismatch')

    const req = makeCallbackRequest({ code: 'auth-code-7', state: 'valid-csrf-state' })
    const res = await GET(req as any)

    expect(res.status).toBe(307)
    const location = getLocation(res)
    expect(location).toContain('/login')
    expect(location).toContain('error=')

    expect(h.issuedTokens.length).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════
// Additional: Existing email user links googleSub on first Google login
// ════════════════════════════════════════════════════════════════
describe('Google account linking for existing email+password users', () => {
  beforeEach(() => {
    // Create a user with email+password but NO googleSub yet
    h.users['existing@example.com'] = {
      id: 'user-existing-1',
      email: 'existing@example.com',
      name: 'Existing User',
      googleSub: null,
      passwordHash: 'some-hash',
    }
    h.memberships.push({
      id: 'mem-existing',
      userId: 'user-existing-1',
      orgId: 'org-acme',
      role: 'operator',
    })
  })

  it('links googleSub to existing user by email, then logs them in', async () => {
    h.mockClaims = {
      sub: 'new-google-sub-456',
      email: 'existing@example.com',
      email_verified: true,
      name: 'Existing User',
    }

    const req = makeCallbackRequest({ code: 'auth-code-link', state: 'valid-csrf-state' })
    const res = await GET(req as any)

    expect(res.status).toBe(307)
    const location = getLocation(res)
    expect(location).toBe('http://localhost:3001/build/release')

    // Session issued for existing user
    expect(h.issuedTokens.length).toBe(1)
    expect(h.issuedTokens[0].userId).toBe('user-existing-1')
    expect(h.issuedTokens[0].orgId).toBe('org-acme')
    expect(h.issuedTokens[0].role).toBe('operator')

    // googleSub was updated on the existing user
    expect(h.users['existing@example.com'].googleSub).toBe('new-google-sub-456')
  })
})

// ════════════════════════════════════════════════════════════════
// Missing code parameter
// ════════════════════════════════════════════════════════════════
describe('Missing authorization code', () => {
  it('returns error redirect when code is missing', async () => {
    const req = makeCallbackRequest({ state: 'valid-csrf-state' })
    const res = await GET(req as any)

    expect(res.status).toBe(307)
    const location = getLocation(res)
    expect(location).toContain('/login')
    expect(location).toContain('error=')
  })
})

// ════════════════════════════════════════════════════════════════
// Google returns error in callback
// ════════════════════════════════════════════════════════════════
describe('Google returns error', () => {
  it('handles error param from Google', async () => {
    const req = makeCallbackRequest({
      error: 'access_denied',
      error_description: 'User denied access',
      state: 'valid-csrf-state',
    })
    const res = await GET(req as any)

    expect(res.status).toBe(307)
    const location = getLocation(res)
    expect(location).toContain('/login')
    expect(location).toContain('error=')
  })
})

// ════════════════════════════════════════════════════════════════
// Task 2: Existing user with 0 memberships + pending invite → logs in
// (Stale-membership read after sweepPendingInvites fix)
// ════════════════════════════════════════════════════════════════
describe('Task 2: Existing user with 0 memberships + pending invite succeeds (stale read fix)', () => {
  it('googleSub match: existing user with no memberships + 1 pending invite logs in', async () => {
    // User exists by googleSub but has 0 memberships
    h.users['stale-gsub@example.com'] = {
      id: 'user-stale-gsub',
      email: 'stale-gsub@example.com',
      name: 'Stale GSub User',
      googleSub: 'google-sub-stale',
      passwordHash: null,
    }
    // 0 memberships — user is orphaned until sweep creates one
    // Create 1 pending email-bound invitation
    h.invitations['inv-stale-gsub'] = {
      id: 'inv-stale-gsub',
      email: 'stale-gsub@example.com',
      orgId: 'org-acme',
      invitedBy: 'owner-1',
      role: 'operator',
      token: 'token-stale-gsub',
      state: 'pending',
      expiresAt: new Date(Date.now() + 86400000),
    }

    h.mockClaims = {
      sub: 'google-sub-stale',
      email: 'stale-gsub@example.com',
      email_verified: true,
      name: 'Stale GSub User',
    }

    const req = makeCallbackRequest({ code: 'auth-code-stale-gsub', state: 'valid-csrf-state' })
    const res = await GET(req as any)

    // Must succeed (307 → /build/release), NOT error with "No organization membership"
    expect(res.status).toBe(307)
    const location = getLocation(res)
    expect(location).toBe('http://localhost:3001/build/release')

    const cookie = getSetCookie(res)
    expect(cookie).toContain('intera_session=mock-token-')

    // Session issued with the swept org + role
    expect(h.issuedTokens.length).toBe(1)
    expect(h.issuedTokens[0].userId).toBe('user-stale-gsub')
    expect(h.issuedTokens[0].orgId).toBe('org-acme')
    expect(h.issuedTokens[0].role).toBe('operator')

    // Membership was created by the sweep
    const mems = h.memberships.filter((m) => m.userId === 'user-stale-gsub')
    expect(mems.length).toBe(1)
    expect(mems[0].orgId).toBe('org-acme')
    expect(mems[0].role).toBe('operator')

    // Invitation was marked accepted
    expect(h.invitations['inv-stale-gsub'].state).toBe('accepted')
  })

  it('email match: existing user with no memberships + 1 pending invite logs in, googleSub linked', async () => {
    // User exists by email but has 0 memberships and no googleSub
    h.users['stale-email@example.com'] = {
      id: 'user-stale-email',
      email: 'stale-email@example.com',
      name: 'Stale Email User',
      googleSub: null,
      passwordHash: 'some-hash',
    }
    // 0 memberships
    // Create 1 pending email-bound invitation
    h.invitations['inv-stale-email'] = {
      id: 'inv-stale-email',
      email: 'stale-email@example.com',
      orgId: 'org-acme',
      invitedBy: 'owner-1',
      role: 'operator',
      token: 'token-stale-email',
      state: 'pending',
      expiresAt: new Date(Date.now() + 86400000),
    }

    h.mockClaims = {
      sub: 'new-google-sub-xyz',
      email: 'stale-email@example.com',
      email_verified: true,
      name: 'Stale Email User',
    }

    const req = makeCallbackRequest({ code: 'auth-code-stale-email', state: 'valid-csrf-state' })
    const res = await GET(req as any)

    expect(res.status).toBe(307)
    const location = getLocation(res)
    expect(location).toBe('http://localhost:3001/build/release')

    const cookie = getSetCookie(res)
    expect(cookie).toContain('intera_session=mock-token-')

    // Session issued
    expect(h.issuedTokens.length).toBe(1)
    expect(h.issuedTokens[0].userId).toBe('user-stale-email')
    expect(h.issuedTokens[0].orgId).toBe('org-acme')
    expect(h.issuedTokens[0].role).toBe('operator')

    // Membership was created by the sweep
    const mems = h.memberships.filter((m) => m.userId === 'user-stale-email')
    expect(mems.length).toBe(1)
    expect(mems[0].orgId).toBe('org-acme')
    expect(mems[0].role).toBe('operator')

    // googleSub was linked to the existing user
    expect(h.users['stale-email@example.com'].googleSub).toBe('new-google-sub-xyz')

    // Invitation was marked accepted
    expect(h.invitations['inv-stale-email'].state).toBe('accepted')
  })
})

// ════════════════════════════════════════════════════════════════
// Task 3: Share-link via Google redemption (S8–S11)
// ════════════════════════════════════════════════════════════════

// S8 — share link, new user
describe('S8: Share link — new user registers via Google', () => {
  beforeEach(() => {
    // Share-link invitation: email=null, limited uses, not yet consumed
    h.invitations['inv-share-1'] = {
      id: 'inv-share-1',
      email: null,
      orgId: 'org-acme',
      invitedBy: 'owner-1',
      role: 'viewer',
      token: 'share-1',
      state: 'pending',
      expiresAt: new Date(Date.now() + 7 * 86400000), // +7d
      maxUses: 2,
      useCount: 0,
    }
    // CSRF cookie carries the token after colon
    h.mockCsrfState = 'valid-csrf-state:share-1'
    // Brand-new email not in any user
    h.mockClaims = {
      sub: 'google-sub-new-user',
      email: 'brand-new@example.com',
      email_verified: true,
      name: 'Brand New User',
    }
  })

  it('creates User + Membership with viewer role, increments useCount, redirects /build/release', async () => {
    const req = makeCallbackRequest({ code: 'auth-code-s8', state: 'valid-csrf-state' })
    const res = await GET(req as any)

    // Success redirect
    expect(res.status).toBe(307)
    const location = getLocation(res)
    expect(location).toBe('http://localhost:3001/build/release')

    // Session issued
    const cookie = getSetCookie(res)
    expect(cookie).toContain('intera_session=mock-token-')

    // User was created
    const user = h.users['brand-new@example.com']
    expect(user).toBeTruthy()
    expect(user.email).toBe('brand-new@example.com')
    expect(user.googleSub).toBe('google-sub-new-user')

    // Membership created with viewer role in org-acme
    const mem = h.memberships.find((m) => m.userId === user.id)
    expect(mem).toBeTruthy()
    expect(mem!.orgId).toBe('org-acme')
    expect(mem!.role).toBe('viewer')

    // useCount incremented
    expect(h.invitations['inv-share-1'].useCount).toBe(1)
    // State stays pending (not yet at max)
    expect(h.invitations['inv-share-1'].state).toBe('pending')

    // Session token carries correct role
    expect(h.issuedTokens.length).toBe(1)
    expect(h.issuedTokens[0].userId).toBe(user.id)
    expect(h.issuedTokens[0].orgId).toBe('org-acme')
    expect(h.issuedTokens[0].role).toBe('viewer')
  })
})

// S9 — share link at max uses
describe('S9: Share link — at max uses, rejects', () => {
  beforeEach(() => {
    h.invitations['inv-share-1'] = {
      id: 'inv-share-1',
      email: null,
      orgId: 'org-acme',
      invitedBy: 'owner-1',
      role: 'viewer',
      token: 'share-1',
      state: 'pending',
      expiresAt: new Date(Date.now() + 7 * 86400000),
      maxUses: 2,
      useCount: 2,
    }
    h.mockCsrfState = 'valid-csrf-state:share-1'
    h.mockClaims = {
      sub: 'google-sub-maxed',
      email: 'maxed@example.com',
      email_verified: true,
      name: 'Maxed User',
    }
  })

  it('returns error redirect "maximum number of uses", no User created', async () => {
    const userCountBefore = Object.keys(h.users).length
    const req = makeCallbackRequest({ code: 'auth-code-s9', state: 'valid-csrf-state' })
    const res = await GET(req as any)

    expect(res.status).toBe(307)
    const location = getLocation(res)
    expect(location).toContain('/login')
    expect(location).toContain('error=')
    expect(location).toContain('maximum')

    // No user created
    expect(Object.keys(h.users).length).toBe(userCountBefore)
    expect(h.issuedTokens.length).toBe(0)
  })
})

// S10 — share link last use flips state
describe('S10: Share link — last use flips state to accepted', () => {
  beforeEach(() => {
    h.invitations['inv-share-1'] = {
      id: 'inv-share-1',
      email: null,
      orgId: 'org-acme',
      invitedBy: 'owner-1',
      role: 'viewer',
      token: 'share-1',
      state: 'pending',
      expiresAt: new Date(Date.now() + 7 * 86400000),
      maxUses: 2,
      useCount: 1,
    }
    h.mockCsrfState = 'valid-csrf-state:share-1'
    h.mockClaims = {
      sub: 'google-sub-last-use',
      email: 'last-use@example.com',
      email_verified: true,
      name: 'Last Use User',
    }
  })

  it('increments useCount to 2 and flips state to accepted', async () => {
    const req = makeCallbackRequest({ code: 'auth-code-s10', state: 'valid-csrf-state' })
    const res = await GET(req as any)

    expect(res.status).toBe(307)
    const location = getLocation(res)
    expect(location).toBe('http://localhost:3001/build/release')

    // useCount incremented to 2
    expect(h.invitations['inv-share-1'].useCount).toBe(2)
    // State flipped to accepted (reached limit)
    expect(h.invitations['inv-share-1'].state).toBe('accepted')

    // User + Membership created
    const user = h.users['last-use@example.com']
    expect(user).toBeTruthy()
    const mem = h.memberships.find((m) => m.userId === user.id)
    expect(mem).toBeTruthy()
    expect(mem!.role).toBe('viewer')
  })
})

// S11 — email-bound invite reached by token, wrong email
describe('S11: Email-bound invite by token — mismatched email rejects', () => {
  beforeEach(() => {
    // Email-bound invitation for a@x.com, with token e-1
    h.invitations['inv-e1'] = {
      id: 'inv-e1',
      email: 'a@x.com',
      orgId: 'org-acme',
      invitedBy: 'owner-1',
      role: 'operator',
      token: 'e-1',
      state: 'pending',
      expiresAt: new Date(Date.now() + 7 * 86400000),
    }
    // CSRF cookie carries token e-1
    h.mockCsrfState = 'valid-csrf-state:e-1'
    // User signs in with a different email b@x.com
    h.mockClaims = {
      sub: 'google-sub-b',
      email: 'b@x.com',
      email_verified: true,
      name: 'Wrong Email User',
    }
  })

  it('returns error redirect "Email does not match", no User created', async () => {
    const userCountBefore = Object.keys(h.users).length
    const req = makeCallbackRequest({ code: 'auth-code-s11', state: 'valid-csrf-state' })
    const res = await GET(req as any)

    expect(res.status).toBe(307)
    const location = getLocation(res)
    expect(location).toContain('/login')
    expect(location).toContain('error=')
    expect(location).toContain('Email')

    // No user created
    expect(Object.keys(h.users).length).toBe(userCountBefore)
    expect(h.issuedTokens.length).toBe(0)
  })
})
