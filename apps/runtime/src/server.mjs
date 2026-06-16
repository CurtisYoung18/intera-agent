import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'

export const INTERNAL_SECRET_HEADER = 'x-intera-internal'
export const RUNTIME_BYPASS_HEADER = 'x-intera-runtime-bypass'

function normalizeBaseUrl(raw) {
  const value = raw?.trim()
  if (!value) return null
  return value.replace(/\/+$/, '')
}

export function resolveConsoleBaseUrl(env = process.env) {
  return normalizeBaseUrl(env.CONSOLE_INTERNAL_URL)
    ?? normalizeBaseUrl(env.CONSOLE_INTERNAL_MESSAGES_URL)?.replace(/\/api\/messages$/, '')
    ?? `http://127.0.0.1:${env.CONSOLE_PORT || '3000'}`
}

export function resolveConsoleMessagesUrl(env = process.env) {
  return normalizeBaseUrl(env.CONSOLE_INTERNAL_MESSAGES_URL)
    ?? `${resolveConsoleBaseUrl(env)}/api/messages`
}

export function resolveConsoleRuntimeHealthUrl(env = process.env) {
  return `${resolveConsoleBaseUrl(env)}/api/internal/runtime/health`
}

export function resolveRuntimeExecutionMode(env = process.env) {
  const value = env.INTERA_RUNTIME_EXECUTION_MODE?.trim().toLowerCase()
  if (value === 'legacy' || value === 'legacy-forward') return 'legacy-forward'
  return 'direct'
}

export function authorizeInternalRequest(headers, env = process.env) {
  const secret = env.INTERNAL_API_SECRET
  if (!secret) return false
  const header = headers[INTERNAL_SECRET_HEADER] ?? headers[INTERNAL_SECRET_HEADER.toLowerCase()]
  const value = Array.isArray(header) ? header[0] : header
  if (!value) return false

  const expected = Buffer.from(secret)
  const actual = Buffer.from(String(value))
  if (expected.length !== actual.length) {
    timingSafeEqual(expected, expected)
    return false
  }
  return timingSafeEqual(expected, actual)
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function routeInfo(req) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const parts = url.pathname.split('/').filter(Boolean)
  return { url, parts }
}

async function readBody(req, limit = 100_000) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error(`Request body too large (max ${limit} bytes)`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function withPathCaseId(rawBody, caseId) {
  if (!caseId || caseId === '_unresolved') return rawBody
  try {
    const parsed = rawBody ? JSON.parse(rawBody) : {}
    if (!parsed.caseId) parsed.caseId = caseId
    return JSON.stringify(parsed)
  } catch {
    return rawBody
  }
}

async function pipeFetchResponse(fetchResponse, res) {
  const headers = {}
  for (const [key, value] of fetchResponse.headers.entries()) {
    if (key.toLowerCase() === 'content-encoding') continue
    headers[key] = value
  }
  if (!headers['content-type']) headers['content-type'] = 'text/event-stream; charset=utf-8'
  headers['cache-control'] = headers['cache-control'] ?? 'no-cache, no-transform'

  res.writeHead(fetchResponse.status, headers)
  if (!fetchResponse.body) {
    res.end()
    return
  }

  for await (const chunk of fetchResponse.body) {
    res.write(chunk)
  }
  res.end()
}

function pickNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback
}

async function loadConsoleRuntimeHealth(fetchImpl, env) {
  const response = await fetchImpl(resolveConsoleRuntimeHealthUrl(env), {
    method: 'GET',
    headers: {
      [INTERNAL_SECRET_HEADER]: env.INTERNAL_API_SECRET || '',
    },
  })
  if (!response.ok) {
    throw new Error(`Console runtime health returned ${response.status}`)
  }
  return await response.json()
}

async function loadDirectRuntimeHealth() {
  const { getRuntimeSessionStats } = await import('../../console/lib/agent/session-store.ts')
  const stats = getRuntimeSessionStats()
  return {
    status: 'ok',
    sessions: stats.liveSessions,
    activeRuns: stats.activeRuns,
    queueDepth: stats.queueDepth,
    stats,
  }
}

async function executeDirectMessagesHandler(body, headers) {
  const { NextRequest } = await import('next/server')
  const { POST } = await import('../../console/app/api/messages/route.ts')
  const request = new NextRequest('http://intera-runtime.internal/api/messages', {
    method: 'POST',
    headers,
    body,
  })
  return await POST(request)
}

async function executeDirectCloseHandler(caseId, headers) {
  const { NextRequest } = await import('next/server')
  const { POST } = await import('../../console/app/api/internal/cases/[caseId]/close/route.ts')
  const request = new NextRequest(`http://intera-runtime.internal/api/internal/cases/${encodeURIComponent(caseId)}/close`, {
    method: 'POST',
    headers,
    body: '{}',
  })
  return await POST(request, { params: Promise.resolve({ caseId }) })
}

export function createRuntimeServer(options = {}) {
  const env = options.env ?? process.env
  const fetchImpl = options.fetch ?? globalThis.fetch
  const executionMode = resolveRuntimeExecutionMode(env)
  const directRuntimeHealth = options.directRuntimeHealth ?? loadDirectRuntimeHealth
  const directMessagesHandler = options.directMessagesHandler ?? executeDirectMessagesHandler
  const directCloseHandler = options.directCloseHandler ?? executeDirectCloseHandler
  const state = {
    startedAt: new Date().toISOString(),
    inFlightCases: new Set(),
  }

  return createServer(async (req, res) => {
    const { parts } = routeInfo(req)

    if (req.method === 'GET' && parts.join('/') === 'internal/health') {
      try {
        const upstream = executionMode === 'direct'
          ? await directRuntimeHealth()
          : await loadConsoleRuntimeHealth(fetchImpl, env)
        const upstreamStats = upstream?.stats ?? {}
        json(res, 200, {
          status: 'ok',
          mode: executionMode,
          sessions: pickNumber(upstream.sessions, pickNumber(upstreamStats.liveSessions)),
          activeRuns: pickNumber(upstream.activeRuns, pickNumber(upstreamStats.activeRuns)),
          queueDepth: pickNumber(upstream.queueDepth, pickNumber(upstreamStats.queueDepth)),
          startedAt: state.startedAt,
          local: {
            inFlightCases: state.inFlightCases.size,
          },
          ...(executionMode === 'legacy-forward'
            ? { upstream: { status: upstream.status ?? 'ok', stats: upstreamStats } }
            : { stats: upstreamStats }),
        })
      } catch (err) {
        json(res, 503, {
          status: 'degraded',
          mode: executionMode,
          sessions: state.inFlightCases.size,
          activeRuns: state.inFlightCases.size,
          queueDepth: 0,
          startedAt: state.startedAt,
          local: {
            inFlightCases: state.inFlightCases.size,
          },
          upstreamError: err instanceof Error ? err.message : String(err),
        })
      }
      return
    }

    const isInternalCaseRoute =
      parts[0] === 'internal' &&
      parts[1] === 'cases' &&
      parts.length >= 3

    if (!isInternalCaseRoute) {
      json(res, 404, { error: 'Not found' })
      return
    }

    if (!authorizeInternalRequest(req.headers, env)) {
      json(res, 401, { error: 'Unauthorized' })
      return
    }

    const caseId = decodeURIComponent(parts[2])
    const action = parts[3]
    const orgId = req.headers['x-intera-org']
    if (!orgId || Array.isArray(orgId)) {
      json(res, 400, { error: 'Missing x-intera-org header' })
      return
    }

    const agentConfigId = req.headers['x-intera-agent-config-id']
    const forwardHeaders = {
      'Content-Type': req.headers['content-type'] || 'application/json',
      [INTERNAL_SECRET_HEADER]: env.INTERNAL_API_SECRET || '',
      [RUNTIME_BYPASS_HEADER]: '1',
      'x-intera-org': orgId,
      ...(typeof agentConfigId === 'string' ? { 'x-intera-agent-config-id': agentConfigId } : {}),
    }

    try {
      if (req.method === 'POST' && (action === 'messages' || (caseId === 'messages' && !action))) {
        const pathCaseId = caseId === 'messages' ? '_unresolved' : caseId
        const rawBody = await readBody(req)
        const body = withPathCaseId(rawBody, pathCaseId)

        state.inFlightCases.add(pathCaseId)
        try {
          const upstream = executionMode === 'direct'
            ? await directMessagesHandler(body, forwardHeaders)
            : await fetchImpl(resolveConsoleMessagesUrl(env), {
                method: 'POST',
                headers: forwardHeaders,
                body,
              })
          await pipeFetchResponse(upstream, res)
        } finally {
          state.inFlightCases.delete(pathCaseId)
        }
        return
      }

      if (req.method === 'POST' && action === 'close') {
        const upstream = executionMode === 'direct'
          ? await directCloseHandler(caseId, forwardHeaders)
          : await fetchImpl(`${resolveConsoleBaseUrl(env)}/api/internal/cases/${encodeURIComponent(caseId)}/close`, {
              method: 'POST',
              headers: forwardHeaders,
              body: '{}',
            })
        await pipeFetchResponse(upstream, res)
        return
      }
    } catch (err) {
      json(res, 502, {
        error: 'Runtime upstream failure',
        detail: err instanceof Error ? err.message : String(err),
      })
      return
    }

    json(res, 404, { error: 'Not found' })
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.RUNTIME_PORT || process.env.PORT || 3101)
  const host = process.env.RUNTIME_HOST || '127.0.0.1'
  createRuntimeServer().listen(port, host, () => {
    console.log(`[Intera Runtime] listening on http://${host}:${port}`)
  })
}
