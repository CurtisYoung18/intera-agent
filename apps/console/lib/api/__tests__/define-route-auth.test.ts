// define-route auth mode tests — proves each auth mode resolves
// correct orgId, and error cases produce correct status codes.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

// ── Mocks (hoisted by vitest) ──

const h = vi.hoisted(() => {
  const agentConfigs: Record<string, { id: string; orgId: string }> = {}
  const repoForOrgMock = vi.fn((orgId: string) => ({
    orgId,
    agentConfig: {
      findUnique: vi.fn(async (args: any) => {
        const id = args?.where?.id
        const config = agentConfigs[id]
        if (!config || config.orgId !== orgId) return null
        return { id: config.id }
      }),
    },
  }))
  return { agentConfigs, repoForOrgMock }
})

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

vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg: h.repoForOrgMock,
}))

vi.mock('@intera/shared/prisma', () => {
  // Use Proxy so repoForOrg can access any model property without crashing
  const findManyMock = vi.fn()
  // Default no-op proxy for any unlisted model — returns itself for chaining
  const noopModel = new Proxy({}, { get: () => vi.fn() })
  return {
    prisma: new Proxy(
      {
        channelBinding: { findMany: findManyMock },
      },
      {
        get(target, prop) {
          if (typeof prop === 'symbol') return undefined
          if (prop in target) return (target as any)[prop]
          return noopModel
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

function mkReq(
  url = 'http://localhost/api/test',
  opts?: { method?: string; headers?: Record<string, string>; body?: BodyInit },
): NextRequest {
  return new NextRequest(new URL(url), opts)
}

const mockGetSession = getSession as ReturnType<typeof vi.fn>
const mockResolveApiKey = resolveOrgFromApiKey as ReturnType<typeof vi.fn>
const mockTrustedCall = isTrustedInternalCall as ReturnType<typeof vi.fn>
const mockFindMany = (prisma as any).channelBinding.findMany as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  h.agentConfigs.agent_a = { id: 'agent_a', orgId: 'acme' }
  h.agentConfigs.agent_b = { id: 'agent_b', orgId: 'other-org' }
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

  // ─── scope: agent ───

  describe('scope: agent', () => {
    it('rejects a foreign query agentConfigId before the route handler runs', async () => {
      mockGetSession.mockResolvedValue({ userId: 'u1', orgId: 'acme', role: 'admin' })

      let called = false
      const handler = defineRoute<{ agentConfigId: string }>({
        method: 'GET',
        scope: 'agent',
        inputSchema: z.object({ agentConfigId: z.string() }),
        parseQuery: true,
        handler: async () => {
          called = true
          return { ok: true, data: {} }
        },
      })

      const res = await handler(mkReq('http://localhost/api/test?agentConfigId=agent_b'))
      const body = await res.json()

      expect(res.status).toBe(404)
      expect(body.error.code).toBe('not_found')
      expect(called).toBe(false)
    })

    it('allows an owned body agentConfigId before invoking the route handler', async () => {
      mockGetSession.mockResolvedValue({ userId: 'u1', orgId: 'acme', role: 'admin' })

      let captured: any = null
      const handler = defineRoute<{ agentConfigId: string }>({
        method: 'POST',
        scope: 'agent',
        inputSchema: z.object({ agentConfigId: z.string() }),
        handler: async (ctx) => {
          captured = ctx.input
          return { ok: true, data: { ok: true } }
        },
      })

      const res = await handler(mkReq('http://localhost/api/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentConfigId: 'agent_a' }),
      }))

      expect(res.status).toBe(200)
      expect(captured).toEqual({ agentConfigId: 'agent_a' })
    })

    it('resolves agentConfigId from route params when the route carries the agent id in the path', async () => {
      mockGetSession.mockResolvedValue({ userId: 'u1', orgId: 'acme', role: 'admin' })

      let called = false
      const handler = defineRoute<void, { agentConfigId: string }>({
        method: 'GET',
        scope: 'agent',
        handler: async () => {
          called = true
          return { ok: true, data: {} }
        },
      })

      const res = await handler(mkReq(), { params: Promise.resolve({ agentConfigId: 'agent_b' }) })
      const body = await res.json()

      expect(res.status).toBe(404)
      expect(body.error.code).toBe('not_found')
      expect(called).toBe(false)
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

    it('trusted-internal call reads agentConfigId from x-intera-agent-config-id header', async () => {
      mockTrustedCall.mockReturnValue(true)

      let captured: any = null
      const handler = defineRoute({
        method: 'POST',
        auth: 'apiKey',
        handler: async (ctx) => {
          captured = ctx.session
          return { ok: true, data: {} }
        },
      })

      const req = mkReq('http://localhost/api/messages', {
        headers: {
          'x-intera-org': 'acme',
          'x-intera-agent-config-id': 'agent-cfg-42',
        },
      })
      await handler(req)

      expect(captured.orgId).toBe('acme')
      expect(captured.agentConfigId).toBe('agent-cfg-42')
      expect(captured.authMode).toBe('apiKey')
    })

    it('external apiKey call IGNORES x-intera-agent-config-id header (security)', async () => {
      // Non-internal call: header must be ignored. agentConfigId comes from apiKey binding.
      mockTrustedCall.mockReturnValue(false)
      mockResolveApiKey.mockResolvedValue({ orgId: 'api-org', agentConfigId: 'cfg-from-apikey' })

      let captured: any = null
      const handler = defineRoute({
        method: 'POST',
        auth: 'apiKey',
        handler: async (ctx) => {
          captured = ctx.session
          return { ok: true, data: {} }
        },
      })

      const req = mkReq('http://localhost/api/messages', {
        headers: {
          Authorization: 'Bearer sk-valid',
          'x-intera-agent-config-id': 'injected-by-attacker',
        },
      })
      await handler(req)

      // agentConfigId comes from the API key binding, NOT the header
      expect(captured.orgId).toBe('api-org')
      expect(captured.agentConfigId).toBe('cfg-from-apikey')
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
      mockFindMany.mockResolvedValue([{ credentials: JSON.stringify({ webhookSecret: 'secret-123' }) }])

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
      expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          channel: 'livechat',
          enabled: true,
          agentConfig: { orgId: 'acme', isActive: true },
        }),
        take: 2,
      }))
    })

    it('returns 401 with wrong x-webhook-secret header', async () => {
      mockTrustedCall.mockReturnValue(false)
      mockFindMany.mockResolvedValue([{ credentials: JSON.stringify({ webhookSecret: 'secret-123' }) }])

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

    it('returns 401 when header-auth webhook is not configured', async () => {
      mockTrustedCall.mockReturnValue(false)
      mockFindMany.mockResolvedValue([])

      const handler = defineRoute({
        method: 'POST',
        auth: 'webhook',
        handler: async () => ({ ok: true, data: {} }),
      })

      const req = mkReq('http://localhost/api/livechat/webhook/acme', {
        headers: { 'x-webhook-secret': 'secret-123' },
      })
      const res = await handler(req, { params: Promise.resolve({ orgId: 'acme' }) })
      expect(res.status).toBe(401)
    })

    it('returns 401 when org header-auth webhook is ambiguous', async () => {
      mockTrustedCall.mockReturnValue(false)
      mockFindMany.mockResolvedValue([
        { credentials: JSON.stringify({ webhookSecret: 'secret-123' }) },
        { credentials: JSON.stringify({ webhookSecret: 'secret-456' }) },
      ])

      const handler = defineRoute({
        method: 'POST',
        auth: 'webhook',
        handler: async () => ({ ok: true, data: {} }),
      })

      const req = mkReq('http://localhost/api/livechat/webhook/acme', {
        headers: { 'x-webhook-secret': 'secret-123' },
      })
      const res = await handler(req, { params: Promise.resolve({ orgId: 'acme' }) })
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
