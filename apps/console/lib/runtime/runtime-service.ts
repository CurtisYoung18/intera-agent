import { NextRequest, NextResponse } from 'next/server'

import { INTERNAL_SECRET_HEADER, isTrustedInternalCall } from '@/lib/api-auth'

export const RUNTIME_BYPASS_HEADER = 'x-intera-runtime-bypass'

export function normalizeRuntimeBaseUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null
  return value.replace(/\/+$/, '')
}

export function resolveRuntimeInternalBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  return normalizeRuntimeBaseUrl(env.INTERA_RUNTIME_URL ?? env.RUNTIME_INTERNAL_URL)
}

export function extractMessageCaseId(rawBody: string): string | null {
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>
    const caseId = parsed.caseId
    return typeof caseId === 'string' && caseId.trim() ? caseId.trim() : null
  } catch {
    return null
  }
}

export function extractMessageAgentConfigId(rawBody: string): string | null {
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>
    for (const key of ['configId', 'agentConfigId']) {
      const value = parsed[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return null
  } catch {
    return null
  }
}

export function buildRuntimeMessagesUrl(baseUrl: string, caseId: string | null): string {
  const safeCaseId = encodeURIComponent(caseId || '_unresolved')
  return `${baseUrl}/internal/cases/${safeCaseId}/messages`
}

function sseErrorResponse(message: string, status = 502): NextResponse {
  const now = new Date().toISOString()
  const payload = [
    `data: ${JSON.stringify({ type: 'error', data: message, timestamp: now })}`,
    '',
    `data: ${JSON.stringify({ type: 'message_stop', data: { reason: 'runtime_proxy_error' }, timestamp: now })}`,
    '',
  ].join('\n')

  return new NextResponse(payload, {
    status,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}

export async function maybeProxyMessagesToRuntime(
  request: NextRequest,
  context: { orgId: string; agentConfigId?: string },
): Promise<NextResponse | null> {
  const baseUrl = resolveRuntimeInternalBaseUrl()
  if (!baseUrl) return null

  // Runtime's legacy-forward mode calls the Console route with an internal
  // bypass header so the strangler seam cannot recursively proxy to itself.
  if (request.headers.get(RUNTIME_BYPASS_HEADER) === '1' && isTrustedInternalCall(request)) {
    return null
  }

  const secret = process.env.INTERNAL_API_SECRET
  if (!secret) {
    return sseErrorResponse('Runtime proxy is configured but INTERNAL_API_SECRET is missing.', 500)
  }

  const rawBody = await request.text()
  const caseId = extractMessageCaseId(rawBody)
  const agentConfigId = context.agentConfigId ?? extractMessageAgentConfigId(rawBody) ?? undefined
  const runtimeUrl = buildRuntimeMessagesUrl(baseUrl, caseId)

  let response: Response
  try {
    response = await fetch(runtimeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': request.headers.get('content-type') ?? 'application/json',
        [INTERNAL_SECRET_HEADER]: secret,
        'x-intera-org': context.orgId,
        ...(agentConfigId ? { 'x-intera-agent-config-id': agentConfigId } : {}),
      },
      body: rawBody,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return sseErrorResponse(`Runtime service unavailable: ${detail}`)
  }

  const headers = new Headers(response.headers)
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'text/event-stream; charset=utf-8')
  }
  headers.set('Cache-Control', headers.get('Cache-Control') ?? 'no-cache, no-transform')

  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
