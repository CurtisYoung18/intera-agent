// define-route auth mode tests — proves each auth mode resolves
// correct orgId, and error cases produce correct status codes.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks (hoisted by vitest) ──

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => ({
  resolveOrgFromApiKey: vi.fn(),
  isTrustedInternalCall: vi.fn(),
}))

vi.mock('@intera/shared/prisma', () => {
  // Use Proxy so repoForOrg can access any model property without crashing
  const findUniqueMock = vi.fn()
  return {
    prisma: new Proxy(
      { liveChatConfig: { findUnique: findUniqueMock } },
      {
        get(target, prop) {
          if (typeof prop === 'symbol') return undefined
          if (prop in target) return (target as any)[prop]
          // Dummy model for any property repoForOrg might access
          return {}
        },
      },
    ),
  }
})

import { NextRequest } from 'next/server'
import { defineRoute } from '@/lib/api/define-route'
import { getSession } from '@/lib/auth'
import { resolveOrgFromApiKey, isTrustedInternalCall } from '@/lib/api-auth'
import { prisma } from '@intera/shared/prisma'

// ── Helpers ──

function mkReq(url = 'http://localhost/api/test', opts?: { headers?: Record<string, string> }): NextRequest {
  return new NextRequest(new URL(url), opts)
}

const mockGetSession = getSession as ReturnType<typeof vi.fn>
const mockResolveApiKey = resolveOrgFromApiKey as ReturnType<typeof vi.fn>
const mockTrustedCall = isTrustedInternalCall as ReturnType<typeof vi.fn>
const mockFindConfig = prisma.liveChatConfig.findUnique as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Tests ──

describe('defineRoute auth modes', () => {
  // ─── auth: session (default) ───

  describe('auth: session', () => {
    it('resolves orgId and role from valid session', async () => {
      mockGetSession.mockResolvedValue({ userId: 'u1', orgId: 'acme', role: 'admin' })

      let captured: any = null
      const handler = defineRoute({
        method: 'GET',
        handler: async (ctx) => {
          captured = ctx.session
          return { ok: true, data: {} }
        },
      })

      await handler(mkReq())
      expect(captured).toMatchObject({
        orgId: 'acme',
        role: 'admin',
        userId: 'u1',
        authMode: 'session',
      })
    })

    it('returns 401 when no valid session', async () => {
      mockGetSession.mockResolvedValue(null)

      const handler = defineRoute({
        method: 'GET',
        handler: async () => ({ ok: true, data: {} }),
      })

      const res = await handler(mkReq())
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error.code).toBe('unauthorized')
    })

    it('returns 403 when requireRole is not met', async () => {
      mockGetSession.mockResolvedValue({ userId: 'u1', orgId: 'acme', role: 'viewer' })

      const handler = defineRoute({
        method: 'POST',
        requireRole: ['admin', 'owner'],
        handler: async () => ({ ok: true, data: {} }),
      })

      const res = await handler(mkReq())
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error.code).toBe('forbidden')
    })

    it('allows handler when role matches requireRole', async () => {
      mockGetSession.mockResolvedValue({ userId: 'u1', orgId: 'acme', role: 'admin' })

      let called = false
      const handler = defineRoute({
        method: 'POST',
        requireRole: ['admin', 'owner'],
        handler: async () => {
          called = true
          return { ok: true, data: {} }
        },
      })

      await handler(mkReq())
      expect(called).toBe(true)
    })
  })

  // ─── auth: apiKey ───

  describe('auth: apiKey', () => {
    it('resolves orgId from valid Bearer token', async () => {
      mockResolveApiKey.mockResolvedValue({ orgId: 'api-org', agentConfigId: 'cfg-1' })

      let captured: any = null
      const handler = defineRoute({
        method: 'POST',
        auth: 'apiKey',
        handler: async (ctx) => {
          captured = ctx.session
          return { ok: true, data: {} }
        },
      })

      await handler(mkReq())
      expect(captured).toMatchObject({
        orgId: 'api-org',
        role: 'admin',
        authMode: 'apiKey',
      })
    })

    it('returns 401 with invalid API key', async () => {
      mockResolveApiKey.mockResolvedValue(null)

      const handler = defineRoute({
        method: 'POST',
        auth: 'apiKey',
        handler: async () => ({ ok: true, data: {} }),
      })

      const res = await handler(mkReq())
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error.code).toBe('unauthorized')
    })

    it('ignores requireRole (apiKey always gets admin)', async () => {
      mockResolveApiKey.mockResolvedValue({ orgId: 'api-org', agentConfigId: null })

      let called = false
      const handler = defineRoute({
        method: 'POST',
        auth: 'apiKey',
        requireRole: ['owner'],
        handler: async () => {
          called = true
          return { ok: true, data: {} }
        },
      })

      await handler(mkReq())
      expect(called).toBe(true)
    })
  })

  // ─── auth: webhook ───

  describe('auth: webhook', () => {
    it('resolves orgId from URL params (internal bridge)', async () => {
      mockTrustedCall.mockReturnValue(true)

      let captured: any = null
      const handler = defineRoute<void, { orgId: string }>({
        method: 'POST',
        auth: 'webhook',
        handler: async (ctx) => {
          captured = ctx.session
          return { ok: true, data: {} }
        },
      })

      const req = mkReq('http://localhost/api/livechat/webhook/acme')
      // defineRoute receives params from Next.js route context
      // We pass params via the second argument
      await handler(req, { params: Promise.resolve({ orgId: 'acme' }) })

      expect(captured).toMatchObject({
        orgId: 'acme',
        role: 'admin',
        authMode: 'webhook',
      })
    })

    it('returns 401 when orgId is missing from params', async () => {
      const handler = defineRoute<void, { orgId: string }>({
        method: 'POST',
        auth: 'webhook',
        handler: async () => ({ ok: true, data: {} }),
      })

      const res = await handler(mkReq(), { params: Promise.resolve({} as any) })
      expect(res.status).toBe(401)
    })

    it('passes with valid x-webhook-secret header', async () => {
      mockTrustedCall.mockReturnValue(false)
      mockFindConfig.mockResolvedValue({ webhookSecret: 'secret-123' })

      let captured: any = null
      const handler = defineRoute<void, { orgId: string }>({
        method: 'POST',
        auth: 'webhook',
        handler: async (ctx) => {
          captured = ctx.session
          return { ok: true, data: {} }
        },
      })

      const req = mkReq('http://localhost/api/livechat/webhook/acme', {
        headers: { 'x-webhook-secret': 'secret-123' },
      })
      await handler(req, { params: Promise.resolve({ orgId: 'acme' }) })

      expect(captured.orgId).toBe('acme')
      expect(captured.authMode).toBe('webhook')
    })

    it('returns 401 with wrong x-webhook-secret header', async () => {
      mockTrustedCall.mockReturnValue(false)
      mockFindConfig.mockResolvedValue({ webhookSecret: 'secret-123' })

      const handler = defineRoute({
        method: 'POST',
        auth: 'webhook',
        handler: async () => ({ ok: true, data: {} }),
      })

      const req = mkReq('http://localhost/api/livechat/webhook/acme', {
        headers: { 'x-webhook-secret': 'wrong-secret' },
      })
      const res = await handler(req, { params: Promise.resolve({ orgId: 'acme' }) })
      expect(res.status).toBe(401)
    })

    it('returns 401 when webhook is not configured', async () => {
      mockTrustedCall.mockReturnValue(false)
      mockFindConfig.mockResolvedValue(null)

      const handler = defineRoute({
        method: 'POST',
        auth: 'webhook',
        handler: async () => ({ ok: true, data: {} }),
      })

      const res = await handler(mkReq(), { params: Promise.resolve({ orgId: 'acme' }) })
      expect(res.status).toBe(401)
    })
  })

  // ─── auth: none ───

  describe('auth: none', () => {
    it('resolves orgId from query params', async () => {
      let captured: any = null
      const handler = defineRoute({
        method: 'GET',
        auth: 'none',
        handler: async (ctx) => {
          captured = ctx.session
          return { ok: true, data: {} }
        },
      })

      await handler(mkReq('http://localhost/api/test?orgId=custom-org'))
      expect(captured).toMatchObject({
        orgId: 'custom-org',
        authMode: 'none',
      })
    })

    it('defaults orgId to "default" when no query param', async () => {
      let captured: any = null
      const handler = defineRoute({
        method: 'GET',
        auth: 'none',
        handler: async (ctx) => {
          captured = ctx.session
          return { ok: true, data: {} }
        },
      })

      await handler(mkReq())
      expect(captured).toMatchObject({
        orgId: 'default',
        authMode: 'none',
      })
    })

    it('has no role set', async () => {
      let captured: any = null
      const handler = defineRoute({
        method: 'GET',
        auth: 'none',
        handler: async (ctx) => {
          captured = ctx.session
          return { ok: true, data: {} }
        },
      })

      await handler(mkReq())
      expect(captured.role).toBeUndefined()
    })
  })

  // ─── Backwards compatibility ───

  describe('backwards compatibility', () => {
    it('defaults auth to session when not specified', async () => {
      mockGetSession.mockResolvedValue({ userId: 'u1', orgId: 'old-org', role: 'operator' })

      let captured: any = null
      const handler = defineRoute({
        method: 'GET',
        handler: async (ctx) => {
          captured = ctx.session
          return { ok: true, data: {} }
        },
      })

      await handler(mkReq())
      expect(captured.authMode).toBe('session')
      expect(captured.orgId).toBe('old-org')
    })
  })
})
