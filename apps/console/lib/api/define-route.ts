// defineRoute — server-side API route wrapper.
//
// Pipeline: verify session → resolve {orgId,userId?,role} → zod-parse input
// (→ 400 validation envelope) → build repoForOrg(orgId) → handler →
// serialize ApiOk | map throw → ApiErr+status.
//
// Every route handler receives: { input, session, repo, audit, log }.
// Exceptions thrown by handlers are mapped to error codes via the
// centralized error→status map (replaces 29 ad-hoc {error:'Internal error'}).

import { NextRequest, NextResponse } from 'next/server'
import type { z } from 'zod'
import {
  apiOk,
  apiErr,
  errorCodeToStatus,
  type ApiEnvelope,
  type ErrorCode,
} from '@intera/shared/contracts/envelope'
import type { AuditWriter } from '@intera/shared/contracts/audit'
import { repoForOrg, type RepoForOrg } from '@/lib/db/repo-for-org'
import { getSession, type ActiveSession } from '@/lib/auth'
import { logger } from '@/lib/logger'

// ── Typed errors handlers can throw ──
export class RouteError extends Error {
  public readonly __isRouteError = true as const

  constructor(
    public code: ErrorCode,
    message: string,
    public fields?: Record<string, string>,
    public statusOverride?: number,
  ) {
    super(message)
    this.name = 'RouteError'
  }
}

/** Check for RouteError via branded property (robust against ESM instance mismatches). */
function isRouteError(err: unknown): err is RouteError {
  return err instanceof RouteError || (err instanceof Error && (err as any).__isRouteError === true)
}

export class NotFoundError extends RouteError {
  constructor(message = 'Not found') { super('not_found', message) }
}
export class ForbiddenError extends RouteError {
  constructor(message = 'Forbidden') { super('forbidden', message) }
}
export class UnauthorizedError extends RouteError {
  constructor(message = 'Unauthorized') { super('unauthorized', message) }
}
export class ConflictError extends RouteError {
  constructor(message = 'Conflict') { super('conflict', message) }
}
export class ValidationError extends RouteError {
  constructor(message: string, fields?: Record<string, string>) { super('validation', message, fields) }
}

// ── Handler context ──
export interface RouteSession {
  orgId: string
  role: ActiveSession['role']
  userId?: string // present after Lane D (G3) adds User/Membership
}

export interface RouteLogger {
  info: (msg: string, ctx?: Record<string, unknown>) => void
  warn: (msg: string, ctx?: Record<string, unknown>) => void
  error: (msg: string, ctx?: Record<string, unknown>) => void
}

export interface RouteContext<Input = void, Params = void> {
  input: Input
  params: Params
  session: RouteSession
  repo: RepoForOrg
  audit: AuditWriter
  log: RouteLogger
}

// ── Route definition ──
// Next.js App Router route context (params is a Promise).
type NextRouteContext<Params> = { params: Promise<Params> }

/** Roles that can access this route. Omit for unauthenticated access.
 *  The handler won't be called if the session role doesn't match. */
type Role = 'owner' | 'admin' | 'operator' | 'viewer'

interface RouteDef<Input, Params> {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** Zod schema for the request body. Omit for body-less routes (GET, DELETE).
   *  Input must produce `Input` after parsing (defaults/transforms applied). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema?: z.ZodType<Input, any, any>
  /** If true, parse query params instead of body (for GET with params). */
  parseQuery?: boolean
  /** Require at least one of these roles. Omit for session-only (any role ok).
   *  Mutations typically want ['admin', 'owner']. */
  requireRole?: Role[]
  handler: (ctx: RouteContext<Input, Params>) => Promise<ApiEnvelope<unknown>>
}

// ── Factory ──
// Returns a function matching the Next.js App Router handler signature.
// The return type uses `any` for the context param to satisfy Next.js's
// auto-generated route type validator — type safety lives inside the
// handler callback where it matters.
export function defineRoute<Input = void, Params = void>(
  def: RouteDef<Input, Params>,
): (req: NextRequest, ctx?: any) => Promise<NextResponse> {
  return async function handler(
    req: NextRequest,
    routeCtx?: any,
  ): Promise<NextResponse> {
    try {
      const session = await resolveSession()
      const log = buildLogger(session)
      const params = (routeCtx?.params ? await routeCtx.params : undefined) as Params

      // 1a. Role gate (S1 — declarative authZ in the seam)
      if (def.requireRole && !def.requireRole.includes(session.role as Role)) {
        return envelopeResponse(
          apiErr('forbidden', `${def.requireRole.join(' or ')} role required`),
          403,
        )
      }

      // 1. Parse input (body or query)
      let input: Input = undefined as Input
      if (def.inputSchema) {
        const raw = def.parseQuery
          ? Object.fromEntries(req.nextUrl.searchParams.entries())
          : await req.json().catch(() => ({}))
        const parsed = def.inputSchema.safeParse(raw)
        if (!parsed.success) {
          const fields: Record<string, string> = {}
          for (const issue of parsed.error.issues) {
            const key = issue.path.join('.') || '_root'
            fields[key] = issue.message
          }
          return envelopeResponse(apiErr('validation', 'Invalid input', fields), 400)
        }
        input = parsed.data
      }

      // 2. Build tenant-scoped repo
      const repo = repoForOrg(session.orgId)

      // 3. Build audit writer — currently a no-op structured logger.
      //    Lane D (G3 identity) will wire this to the AuditLog table.
      //    route handlers call audit({action, target, before?, after?})
      //    and defineRoute fills in actorUserId + orgId.
      const audit: AuditWriter = async (event) => {
        log.info('audit', { ...event, actorUserId: session.userId ?? 'unknown', orgId: session.orgId })
      }

      // 4. Invoke handler
      const ctx: RouteContext<Input, Params> = {
        input: input as Input,
        params: params as Params,
        session,
        repo,
        audit,
        log,
      }
      const result = await def.handler(ctx)

      // 5. Serialize envelope — strip __status marker from body
      if (result.ok) {
        const { __status, ...body } = result as any
        const status = __status === 201 ? 201 : 200
        return NextResponse.json(body, { status })
      }
      return envelopeResponse(result)
    } catch (err) {
      if (isRouteError(err)) {
        const re = err as RouteError
        logger.warn('route error', { code: re.code, message: re.message })
        return envelopeResponse(apiErr(re.code, re.message, re.fields), re.statusOverride)
      }
      logger.error('unhandled error', { message: (err as Error).message ?? String(err) })
      return envelopeResponse(apiErr('internal', 'Internal error'), 500)
    }
  }
}

// ── Helpers ──

async function resolveSession(): Promise<RouteSession> {
  const s = await getSession()
  if (!s) throw new UnauthorizedError('No valid session')
  return { orgId: s.orgId, role: s.role }
}

function buildLogger(session: RouteSession): RouteLogger {
  const base = { orgId: session.orgId, userId: session.userId }
  return {
    info: (msg, ctx) => logger.info(msg, { ...base, ...ctx }),
    warn: (msg, ctx) => logger.warn(msg, { ...base, ...ctx }),
    error: (msg, ctx) => logger.error(msg, { ...base, ...ctx }),
  }
}

function envelopeResponse(envelope: ApiEnvelope<unknown>, statusOverride?: number): NextResponse {
  const status = statusOverride ?? (envelope.ok ? 200 : errorCodeToStatus[envelope.error.code])
  return NextResponse.json(envelope, { status })
}

