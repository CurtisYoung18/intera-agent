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

export function createRuntimeServer(options = {}) {
  const env = options.env ?? process.env
  const fetchImpl = options.fetch ?? globalThis.fetch
  const state = {
    startedAt: new Date().toISOString(),
    inFlightCases: new Set(),
  }

  return createServer(async (req, res) => {
    const { parts } = routeInfo(req)

    if (req.method === 'GET' && parts.join('/') === 'internal/health') {
      json(res, 200, {
        status: 'ok',
        mode: 'legacy-forward',
        sessions: state.inFlightCases.size,
        activeRuns: state.inFlightCases.size,
        queueDepth: 0,
        startedAt: state.startedAt,
      })
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
          const upstream = await fetchImpl(resolveConsoleMessagesUrl(env), {
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
        const closeUrl = `${resolveConsoleBaseUrl(env)}/api/internal/cases/${encodeURIComponent(caseId)}/close`
        const upstream = await fetchImpl(closeUrl, {
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
