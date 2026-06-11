// S4b — Business tool adapter.
// Wraps a DB ToolDefinition as a Tool<I,O> so the executor sees one interface.

import { z } from 'zod'
import type { Tool, ToolContext } from '@intera/shared/tools/tool'
import type { ToolDefinition } from '@intera/shared/types'

function safeZod(schema: unknown): z.ZodType {
  if (schema instanceof z.ZodType) return schema
  return z.object({}).passthrough()
}

export function adaptBusinessTool(def: ToolDefinition): Tool {
  const inputSchema = (def as { zodSchema?: z.ZodType }).zodSchema ?? safeZod(def.inputSchema)

  return {
    name: def.name,
    source: 'business',
    inputSchema,
    guardPhase: (def as { guardPhase?: 'pre' | 'post' }).guardPhase ?? 'post',
    displayVerb: def.displayVerb ?? { text: `Calling ${def.name}`, icon: 'dots' },
    renderHints: (def as { renderHints?: Tool['renderHints'] }).renderHints,

    async prompt() { return def.description },

    isEnabled() { return def.enabled },
    isConcurrencySafe() { return def.isConcurrencySafe },
    isReadOnly() { return def.isConcurrencySafe },

    async call(input: unknown, ctx: ToolContext) {
      if (def.mode === 'static_fixture') return executeMock(def, input)
      return executeHttp(def, input, ctx)
    },
  }
}

// ── executeMock ──────────────────────────────────────────────

const DEFAULT_MOCK_RESPONSES: Record<string, unknown> = {
  query_order_status: { txnId: '', status: 'pending' },
  query_payment_channel_status: { channelStatus: 'normal' },
  get_account_status: { status: 'active' },
}

async function executeMock(def: ToolDefinition, input?: unknown): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 100 + Math.random() * 200))
  if (def.mockFixture && typeof def.mockFixture === 'object') return def.mockFixture
  return DEFAULT_MOCK_RESPONSES[def.name] ?? { ok: true }
}

// ── executeHttp ───────────────────────────────────────────────

async function executeHttp(
  def: ToolDefinition,
  input: unknown,
  ctx: ToolContext,
): Promise<unknown> {
  if (!def.endpoint) throw new Error(`No endpoint for "${def.name}"`)

  const resolvedEndpoint = resolveEnvVars(def.endpoint, ctx)
  const headers = resolveHeaders(def.headers as Record<string, string> | undefined, ctx)

  let body = input

  const response = await fetch(resolvedEndpoint, {
    method: def.httpMethod || 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(def.timeoutMs || 10000),
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  return response.json()
}

function resolveEnvVars(value: string, ctx: ToolContext): string {
  if (ctx.secrets) return ctx.secrets.resolve(value)
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '')
}

function resolveHeaders(
  headers: Record<string, string> | undefined,
  ctx: ToolContext,
): Record<string, string> {
  if (!headers) return {}
  const resolved: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    resolved[k] = ctx.secrets ? ctx.secrets.resolve(v) : v.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '')
  }
  return resolved
}
