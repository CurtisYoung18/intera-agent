#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(__filename), '..')

for (const envFile of ['.env.local', '.env']) {
  const envPath = resolve(ROOT, envFile)
  if (existsSync(envPath)) dotenv.config({ path: envPath })
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:3001'
const DEFAULT_EMAIL = 'admin@intera.local'
const DEFAULT_TIMEZONE = 'Asia/Shanghai'
const DEFAULT_METRICS_WINDOW = '1h'
const SMOKE_ORG_ID = 'default'
const SMOKE_AGENT_ID = 'agent_default_v1'
const SMOKE_CHAT_ID = 'agentops-smoke-chat-1'
const SMOKE_CASE_ID = 'agentops-smoke-case-1'
const SMOKE_RUN_ID = 'agentops-smoke-run-1'
const SMOKE_TASK_ID = 'agentops-smoke-task-1'
const SMOKE_FROM = '2026-06-26T00:00:00.000Z'
const SMOKE_TO = '2026-06-26T01:00:00.000Z'
const SMOKE_WRONG_AGENT_ID = 'agentops-smoke-wrong-agent'
const SMOKE_FAKE_AGENT_ID = 'agentops-smoke-fake-agent'
const SMOKE_PROPOSAL_TITLE = 'AgentOps local smoke proposal'
const SMOKE_EXTERNAL_AGENT_NAME = 'agentops-local-smoke'
const FORBIDDEN_MARKERS = ['demo.anytrans.ai', '43.134.51.138', '/etc/intera/console.env']
const INTERNAL_SENTINELS = [
  'INTERNAL_SMOKE_TOOL_RESULT',
  'backend_id',
  'Authorization',
  'Bearer',
  'smoke-secret-token',
  'provider_trace_id',
]
const FORBIDDEN_SUMMARY_MARKERS = [
  ...FORBIDDEN_MARKERS,
  ...INTERNAL_SENTINELS,
  'DATABASE_URL',
  'intera_session=',
]
const LOCAL_DEV_LISTENER_COMMANDS = new Set([
  'node',
  'nodejs',
  'next',
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'deno',
  'vite',
  'turbo',
])

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

function usage() {
  return `Usage:
  npm run agentops:local -- metrics --agent <agentId> [--window 1h] [--from ISO] [--to ISO] [--timezone Asia/Shanghai] [--metric key]...
  npm run agentops:local -- forensic-pack --agent <agentId> --chat <chatId> [--translate zh]
  npm run smoke:agentops

Environment:
  AGENTOPS_BASE_URL or SMOKE_BASE_URL defaults to ${DEFAULT_BASE_URL}
  AGENTOPS_EMAIL || SMOKE_EMAIL || SEED_OWNER_EMAIL || ${DEFAULT_EMAIL}
  AGENTOPS_PASSWORD || SMOKE_PASSWORD || STAFF_PASSWORD`
}

function parseArgs(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    return { command: 'help', options: {} }
  }

  const [command, ...rest] = argv
  const options = { metric: [] }

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (!arg.startsWith('--')) {
      throw new CliError(`Unexpected argument: ${arg}`)
    }

    const [rawKey, inlineValue] = arg.slice(2).split('=', 2)
    const key = rawKey.trim()
    const value = inlineValue ?? rest[index + 1]
    if (inlineValue == null) index += 1
    if (!value || value.startsWith('--')) {
      throw new CliError(`Missing value for --${key}`)
    }

    if (key === 'metric') {
      options.metric.push(value)
    } else {
      options[key] = value
    }
  }

  return { command, options }
}

function failIfDangerousEnvironment(baseUrl) {
  const findings = []

  for (const marker of FORBIDDEN_MARKERS) {
    if (baseUrl.includes(marker)) findings.push(`base URL contains forbidden marker ${marker}`)
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'NODE_ENV' && value === 'production') {
      findings.push('NODE_ENV=production')
    }
    if (key.startsWith('PRODUCTION_')) {
      findings.push(`production-prefixed env var present: ${key}`)
    }
    if (typeof value === 'string') {
      for (const marker of FORBIDDEN_MARKERS) {
        if (value.includes(marker)) findings.push(`env var ${key} contains forbidden marker ${marker}`)
      }
    }
  }

  if (findings.length > 0) {
    throw new CliError(`Refusing to run outside local safety boundaries:\n- ${findings.join('\n- ')}`)
  }
}

function resolveBaseUrl(options) {
  const baseUrl = String(
    options['base-url'] ??
    process.env.AGENTOPS_BASE_URL ??
    process.env.SMOKE_BASE_URL ??
    DEFAULT_BASE_URL,
  ).replace(/\/+$/, '')

  failIfDangerousEnvironment(baseUrl)

  let parsed
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new CliError(`Invalid base URL: ${baseUrl}`)
  }

  if (parsed.protocol !== 'http:') {
    throw new CliError(`Base URL must use local http, got ${parsed.protocol}`)
  }
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    throw new CliError(`Base URL must be loopback, got ${parsed.hostname}`)
  }
  if (!parsed.port) {
    throw new CliError('Base URL must include an explicit local port')
  }

  return baseUrl
}

function loginCredentials() {
  const email =
    process.env.AGENTOPS_EMAIL ??
    process.env.SMOKE_EMAIL ??
    process.env.SEED_OWNER_EMAIL ??
    DEFAULT_EMAIL
  const password =
    process.env.AGENTOPS_PASSWORD ??
    process.env.SMOKE_PASSWORD ??
    process.env.STAFF_PASSWORD

  if (!password) {
    throw new CliError('Missing AGENTOPS_PASSWORD, SMOKE_PASSWORD, or STAFF_PASSWORD for local login.')
  }
  return { email, password }
}

function parseDatabaseUrl({ requireStandardPort }) {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new CliError('DATABASE_URL is required for smoke fixture creation. Start from .env.example and run docker compose up -d postgres.')
  }

  for (const marker of FORBIDDEN_MARKERS) {
    if (databaseUrl.includes(marker)) {
      throw new CliError(`Refusing DATABASE_URL containing forbidden marker ${marker}`)
    }
  }

  let parsed
  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new CliError('DATABASE_URL is not a valid URL.')
  }

  if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new CliError(`DATABASE_URL host must be localhost or 127.0.0.1 for smoke, got ${parsed.hostname}`)
  }

  const port = parsed.port || '5432'
  const allowNonstandard = process.env.AGENTOPS_ALLOW_NONSTANDARD_LOCAL_DB === '1'
  if (requireStandardPort && port !== '5434' && !allowNonstandard) {
    throw new CliError('Smoke requires local Postgres on port 5434. Set AGENTOPS_ALLOW_NONSTANDARD_LOCAL_DB=1 only for a known local DB.')
  }

  return {
    present: true,
    protocol: parsed.protocol.replace(/:$/, ''),
    host: parsed.hostname,
    port,
    database: parsed.pathname.replace(/^\//, '') || null,
    standardLocalPort: port === '5434',
    nonstandardLocalPortAllowed: allowNonstandard,
  }
}

function assertNoSshTunnelForDbPort(port) {
  let output = ''
  try {
    output = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    // No listener yet, or lsof unavailable. Health/Prisma checks will fail if DB is unreachable.
    return { checked: false, reason: 'no-listener-or-lsof-unavailable' }
  }

  const lines = output.split('\n').filter(Boolean)
  const suspicious = lines.filter(isSshListenerLine)
  if (suspicious.length > 0) {
    throw new CliError(`Refusing to run smoke: database port ${port} appears to be served by an SSH tunnel.`)
  }
  return {
    checked: true,
    listenerCount: Math.max(0, lines.length - 1),
    commands: uniqueListenerCommands(lines.slice(1)),
  }
}

function sanitizeListenerCommand(command) {
  const sanitized = String(command).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64)
  return sanitized || 'unknown'
}

function uniqueListenerCommands(lines) {
  return [...new Set(
    lines
      .map((line) => sanitizeListenerCommand(line.trim().split(/\s+/)[0] ?? ''))
      .filter(Boolean),
  )]
}

function isSshListenerLine(line) {
  return /^\s*ssh(?:\s|$)/i.test(line) || /\bssh\b/i.test(line)
}

function isAcceptedLocalDevCommand(command) {
  const normalized = command.toLowerCase()
  return LOCAL_DEV_LISTENER_COMMANDS.has(normalized) || normalized.startsWith('next-')
}

function assertLocalConsoleListenerForBaseUrl(baseUrl) {
  const parsed = new URL(baseUrl)
  const port = parsed.port
  let output = ''

  try {
    output = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    // No listener yet, or lsof unavailable. The HTTP health check below will fail if the console is unreachable.
    return { checked: false, reason: 'no-listener-or-lsof-unavailable', host: parsed.hostname, port }
  }

  const lines = output.split('\n').filter(Boolean)
  const listenerLines = lines.slice(1)
  const commands = uniqueListenerCommands(listenerLines)
  const suspicious = listenerLines.filter(isSshListenerLine)
  if (suspicious.length > 0) {
    throw new CliError(`Refusing to run smoke: base URL port ${port} appears to be served by an SSH tunnel.`)
  }

  const acceptedCommands = commands.filter(isAcceptedLocalDevCommand)
  if (listenerLines.length > 0 && acceptedCommands.length === 0) {
    const commandList = commands.length > 0 ? commands.join(', ') : 'unknown'
    throw new CliError(
      `Refusing to run smoke: base URL port ${port} is served by ${commandList}, not a recognized local Next/dev listener.`,
    )
  }

  return {
    checked: true,
    host: parsed.hostname,
    port,
    listenerCount: listenerLines.length,
    commands,
    acceptedCommands,
  }
}

function buildUrl(baseUrl, path, query = {}) {
  const url = new URL(path, `${baseUrl}/`)
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url
}

async function fetchJson(url, init = {}) {
  let response
  try {
    response = await fetch(url, init)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new CliError(`HTTP request failed for ${url.origin}${url.pathname}: ${message}`)
  }

  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text.slice(0, 1000) }
  }

  return {
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    json,
  }
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie()
  }
  const combined = headers.get('set-cookie')
  if (!combined) return []
  return combined.split(/,(?=\s*[A-Za-z0-9_-]+=)/g).map((part) => part.trim())
}

function parseSessionCookie(headers) {
  const cookies = getSetCookieHeaders(headers)
  const sessionCookie = cookies.find((cookie) => cookie.startsWith('intera_session='))
  if (!sessionCookie) return null
  const pair = sessionCookie.split(';')[0]
  const eq = pair.indexOf('=')
  if (eq === -1) return null
  return {
    name: pair.slice(0, eq),
    value: pair.slice(eq + 1),
    header: pair,
  }
}

async function login(baseUrl) {
  const { email, password } = loginCredentials()
  const result = await fetchJson(buildUrl(baseUrl, '/api/auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!result.ok || result.json?.ok === false) {
    throw new CliError(`Login failed with HTTP ${result.status}: ${safeJsonForMessage(result.json)}`)
  }

  const cookie = parseSessionCookie(result.headers)
  if (!cookie) {
    throw new CliError('Login succeeded but no intera_session cookie was returned. Check SESSION_SECRET in the local console environment.')
  }

  return { email, cookie, status: result.status }
}

function cookieHeaders(cookie) {
  return {
    accept: 'application/json',
    cookie: cookie.header,
  }
}

function jsonCookieHeaders(cookie) {
  return {
    ...cookieHeaders(cookie),
    'content-type': 'application/json',
  }
}

async function requireOkData(label, result) {
  if (!result.ok || result.json?.ok !== true) {
    throw new CliError(`${label} failed with HTTP ${result.status}: ${safeJsonForMessage(result.json)}`)
  }
  return result.json.data
}

function safeJsonForMessage(value) {
  let text = JSON.stringify(value ?? null)
  for (const secret of [process.env.AGENTOPS_PASSWORD, process.env.SMOKE_PASSWORD, process.env.STAFF_PASSWORD]) {
    if (secret) text = text.replaceAll(secret, '[redacted]')
  }
  return text.slice(0, 1200)
}

function metricsQueryFromOptions(options) {
  return {
    window: options.window ?? DEFAULT_METRICS_WINDOW,
    from: options.from,
    to: options.to,
    timezone: options.timezone ?? DEFAULT_TIMEZONE,
    metrics: options.metric.length > 0 ? options.metric.join(',') : undefined,
  }
}

async function runMetrics(options) {
  if (!options.agent) throw new CliError('metrics requires --agent <agentId>')
  const baseUrl = resolveBaseUrl(options)
  const session = await login(baseUrl)
  const result = await fetchJson(
    buildUrl(baseUrl, `/api/agentops/agents/${encodeURIComponent(options.agent)}/metrics`, metricsQueryFromOptions(options)),
    { headers: cookieHeaders(session.cookie) },
  )
  const data = await requireOkData('metrics', result)
  console.log(JSON.stringify(data, null, 2))
}

async function runForensicPack(options) {
  if (!options.agent) throw new CliError('forensic-pack requires --agent <agentId>')
  if (!options.chat) throw new CliError('forensic-pack requires --chat <chatId>')
  const baseUrl = resolveBaseUrl(options)
  const session = await login(baseUrl)
  const result = await fetchJson(
    buildUrl(
      baseUrl,
      `/api/agentops/agents/${encodeURIComponent(options.agent)}/chats/${encodeURIComponent(options.chat)}/forensic-pack`,
      { translate: options.translate },
    ),
    { headers: cookieHeaders(session.cookie) },
  )
  const data = await requireOkData('forensic-pack', result)
  console.log(JSON.stringify(data, null, 2))
}

async function importPrismaClient() {
  const { PrismaClient } = await import('@prisma/client')
  return new PrismaClient({
    ...(process.env.DATABASE_URL ? { datasourceUrl: process.env.DATABASE_URL } : {}),
  })
}

async function ensureSeededBase(prisma, ownerEmail) {
  const [org, agent, user] = await Promise.all([
    prisma.organization.findUnique({ where: { id: SMOKE_ORG_ID }, select: { id: true } }),
    prisma.agentConfig.findUnique({ where: { id: SMOKE_AGENT_ID }, select: { id: true, orgId: true } }),
    prisma.user.findUnique({
      where: { email: ownerEmail },
      select: {
        id: true,
        passwordHash: true,
        memberships: { where: { orgId: SMOKE_ORG_ID }, select: { orgId: true, role: true } },
      },
    }),
  ])

  const missing = []
  if (!org) missing.push(`Organization ${SMOKE_ORG_ID}`)
  if (!agent || agent.orgId !== SMOKE_ORG_ID) missing.push(`AgentConfig ${SMOKE_AGENT_ID}`)
  if (!user?.passwordHash || user.memberships.length === 0) missing.push(`owner login ${ownerEmail}`)

  if (missing.length > 0) {
    throw new CliError(`Missing local seed data: ${missing.join(', ')}. Run STAFF_PASSWORD=... npm run db:seed, then retry.`)
  }
}

async function recreateSmokeFixture(prisma) {
  const startedAt = new Date('2026-06-26T00:00:00.000Z')
  const userAt = new Date('2026-06-26T00:00:01.000Z')
  const llmAt = new Date('2026-06-26T00:00:02.000Z')
  const toolAt = new Date('2026-06-26T00:00:03.000Z')
  const assistantAt = new Date('2026-06-26T00:00:04.000Z')
  const handoffAt = new Date('2026-06-26T00:00:05.000Z')
  const updatedAt = new Date('2026-06-26T00:00:06.000Z')

  await prisma.$transaction(async (tx) => {
    const baseAgent = await tx.agentConfig.findUnique({
      where: { id: SMOKE_AGENT_ID },
      select: {
        model: true,
        temperature: true,
        thinkingBudget: true,
        maxIterations: true,
        maxOutputTokens: true,
        memoryStrategy: true,
        extendedThinking: true,
        resumePrompt: true,
      },
    })
    if (!baseAgent) {
      throw new CliError(`Missing local seed data: AgentConfig ${SMOKE_AGENT_ID}`)
    }

    const wrongAgentData = {
      orgId: SMOKE_ORG_ID,
      name: 'AgentOps Smoke Wrong Agent',
      version: 1,
      parentId: null,
      isActive: false,
      model: baseAgent.model,
      temperature: baseAgent.temperature,
      thinkingBudget: baseAgent.thinkingBudget,
      maxIterations: baseAgent.maxIterations,
      maxOutputTokens: baseAgent.maxOutputTokens,
      coreSystemPrompt: 'AgentOps smoke wrong-agent fixture. Do not serve real traffic.',
      extendedThinking: baseAgent.extendedThinking,
      memoryStrategy: baseAgent.memoryStrategy,
      gptbotsApiKey: null,
      releaseNote: null,
      publishedAt: null,
      publishedBy: null,
      resumePrompt: baseAgent.resumePrompt,
    }

    await tx.agentConfig.upsert({
      where: { id: SMOKE_WRONG_AGENT_ID },
      update: wrongAgentData,
      create: {
        id: SMOKE_WRONG_AGENT_ID,
        ...wrongAgentData,
      },
    })

    await tx.humanTask.deleteMany({
      where: { OR: [{ id: SMOKE_TASK_ID }, { caseId: SMOKE_CASE_ID }, { chatId: SMOKE_CHAT_ID }, { runId: SMOKE_RUN_ID }] },
    })
    await tx.actionTrace.deleteMany({
      where: { OR: [{ caseId: SMOKE_CASE_ID }, { chatId: SMOKE_CHAT_ID }, { runId: SMOKE_RUN_ID }] },
    })
    await tx.message.deleteMany({
      where: { OR: [{ caseId: SMOKE_CASE_ID }, { chatId: SMOKE_CHAT_ID }, { runId: SMOKE_RUN_ID }] },
    })
    await tx.chatMemory.deleteMany({
      where: { OR: [{ caseId: SMOKE_CASE_ID }, { chatId: SMOKE_CHAT_ID }, { runId: SMOKE_RUN_ID }] },
    })
    await tx.procedureRun.deleteMany({
      where: { OR: [{ id: SMOKE_RUN_ID }, { caseId: SMOKE_CASE_ID }, { chatId: SMOKE_CHAT_ID }] },
    })
    await tx.case.deleteMany({ where: { id: SMOKE_CASE_ID } })

    await tx.case.create({
      data: {
        id: SMOKE_CASE_ID,
        orgId: SMOKE_ORG_ID,
        userId: 'agentops-smoke-user-1',
        chatId: SMOKE_CHAT_ID,
        type: 'deposit_issue',
        status: 'waiting_human',
        source: 'live',
        goal: 'Verify a missing deposit and hand off to payment operations if evidence is inconclusive.',
        blocker: 'Waiting for payment_ops review.',
        runtimeInputEpoch: 1,
        createdAt: startedAt,
        updatedAt,
      },
    })

    await tx.procedureRun.create({
      data: {
        id: SMOKE_RUN_ID,
        orgId: SMOKE_ORG_ID,
        caseId: SMOKE_CASE_ID,
        chatId: SMOKE_CHAT_ID,
        agentConfigId: SMOKE_AGENT_ID,
        procedureId: 'deposit_issue',
        status: 'paused',
        inputEpoch: 1,
        currentStepId: 'handoff_payment_ops',
        outcome: 'handed_off',
        state: {
          runId: SMOKE_RUN_ID,
          agentConfigId: SMOKE_AGENT_ID,
          procedureId: 'deposit_issue',
          status: 'paused',
          inputEpoch: 1,
          currentStepId: 'handoff_payment_ops',
          steps: [
            { id: 'collect_facts', status: 'completed', startedAt: userAt.toISOString(), completedAt: userAt.toISOString() },
            { id: 'investigate_order', status: 'completed', startedAt: toolAt.toISOString(), completedAt: toolAt.toISOString() },
            { id: 'handoff_payment_ops', status: 'active', startedAt: handoffAt.toISOString() },
          ],
          blockers: ['Waiting for payment_ops review.'],
          evidence: [{ toolName: 'get_latest_deposit', status: 'pending' }],
          timeline: [
            {
              eventId: 'agentops-smoke-event-1',
              epoch: 1,
              origin: 'customer',
              source: 'customer_message',
              at: userAt.toISOString(),
              summary: 'Customer reported a missing deposit.',
              basedOnInputEpoch: 1,
              isMeta: false,
            },
            {
              eventId: 'agentops-smoke-event-2',
              epoch: 1,
              origin: 'system',
              source: 'tool_result',
              at: toolAt.toISOString(),
              summary: 'Tool result recorded for deposit lookup.',
              basedOnInputEpoch: 1,
              isMeta: false,
            },
          ],
        },
        createdAt: startedAt,
        updatedAt,
      },
    })

    await tx.message.createMany({
      data: [
        {
          id: 'agentops-smoke-msg-user-1',
          orgId: SMOKE_ORG_ID,
          caseId: SMOKE_CASE_ID,
          chatId: SMOKE_CHAT_ID,
          runId: SMOKE_RUN_ID,
          role: 'user',
          content: 'My CNY 500 deposit is still missing.',
          createdAt: userAt,
        },
        {
          id: 'agentops-smoke-msg-internal-tool-1',
          orgId: SMOKE_ORG_ID,
          caseId: SMOKE_CASE_ID,
          chatId: SMOKE_CHAT_ID,
          runId: SMOKE_RUN_ID,
          role: 'user',
          content: '',
          providerContent: [{
            type: 'tool_result',
            tool_use_id: 'toolu_agentops_smoke_1',
            content: 'INTERNAL_SMOKE_TOOL_RESULT backend_id=be_secret_1 Authorization: Bearer smoke-secret-token provider_trace_id=ptr_secret',
          }],
          providerMeta: {
            protocolVersion: 1,
            providerFamily: 'anthropic',
            visibility: 'internal',
            transcriptKind: 'tool_result',
            toolUseIds: ['toolu_agentops_smoke_1'],
          },
          createdAt: toolAt,
        },
        {
          id: 'agentops-smoke-msg-assistant-1',
          orgId: SMOKE_ORG_ID,
          caseId: SMOKE_CASE_ID,
          chatId: SMOKE_CHAT_ID,
          runId: SMOKE_RUN_ID,
          role: 'assistant',
          content: 'I checked the latest deposit evidence and have handed this to payment operations for review.',
          createdAt: assistantAt,
        },
      ],
    })

    await tx.chatMemory.create({
      data: {
        id: 'agentops-smoke-memory-1',
        orgId: SMOKE_ORG_ID,
        caseId: SMOKE_CASE_ID,
        chatId: SMOKE_CHAT_ID,
        runId: SMOKE_RUN_ID,
        contextMap: JSON.stringify({ amount: 500, currency: 'CNY', status: 'pending_review' }),
        missingFacts: JSON.stringify([]),
        toolsCalled: JSON.stringify(['get_latest_deposit', 'kb_search_deposit']),
        toolResults: JSON.stringify({
          get_latest_deposit: { status: 'pending', amount: 500, currency: 'CNY' },
          kb_search_deposit: { hitCount: 0 },
        }),
        keyEvents: JSON.stringify([
          { at: userAt.toISOString(), text: 'Customer reported a missing deposit.' },
          { at: handoffAt.toISOString(), text: 'Human task created for payment operations.' },
        ]),
        humanTaskStatus: 'pending',
        summary: 'AgentOps smoke chat memory for a missing-deposit handoff.',
        todos: JSON.stringify([{ id: 'handoff_payment_ops', status: 'active' }]),
        createdAt: startedAt,
        updatedAt,
      },
    })

    await tx.actionTrace.createMany({
      data: [
        {
          id: 'agentops-smoke-trace-user-1',
          orgId: SMOKE_ORG_ID,
          caseId: SMOKE_CASE_ID,
          chatId: SMOKE_CHAT_ID,
          runId: SMOKE_RUN_ID,
          actionType: 'user_message',
          title: 'User reported missing deposit',
          detail: 'Customer reported a missing deposit.',
          payload: JSON.stringify({ inputEpoch: 1 }),
          createdAt: userAt,
        },
        {
          id: 'agentops-smoke-trace-llm-1',
          orgId: SMOKE_ORG_ID,
          caseId: SMOKE_CASE_ID,
          chatId: SMOKE_CHAT_ID,
          runId: SMOKE_RUN_ID,
          actionType: 'llm_response',
          title: 'LLM response: end_turn',
          detail: null,
          payload: JSON.stringify({
            model: 'claude-smoke',
            provider: 'anthropic',
            usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10 },
          }),
          createdAt: llmAt,
        },
        {
          id: 'agentops-smoke-trace-tool-call-1',
          orgId: SMOKE_ORG_ID,
          caseId: SMOKE_CASE_ID,
          chatId: SMOKE_CHAT_ID,
          runId: SMOKE_RUN_ID,
          actionType: 'tool_call',
          title: 'Tool called: get_latest_deposit',
          detail: null,
          payload: JSON.stringify({
            toolName: 'get_latest_deposit',
            input: { amount: 500, currency: 'CNY' },
          }),
          createdAt: toolAt,
        },
        {
          id: 'agentops-smoke-trace-tool-result-1',
          orgId: SMOKE_ORG_ID,
          caseId: SMOKE_CASE_ID,
          chatId: SMOKE_CHAT_ID,
          runId: SMOKE_RUN_ID,
          actionType: 'tool_result',
          title: 'Tool result: get_latest_deposit',
          detail: null,
          payload: JSON.stringify({
            toolName: 'get_latest_deposit',
            output: { status: 'pending', amount: 500, currency: 'CNY' },
            latencyMs: 120,
          }),
          createdAt: new Date('2026-06-26T00:00:03.200Z'),
        },
        {
          id: 'agentops-smoke-trace-knowledge-result-1',
          orgId: SMOKE_ORG_ID,
          caseId: SMOKE_CASE_ID,
          chatId: SMOKE_CHAT_ID,
          runId: SMOKE_RUN_ID,
          actionType: 'tool_result',
          title: 'Tool result: kb_search_deposit',
          detail: null,
          payload: JSON.stringify({
            toolName: 'kb_search_deposit',
            knowledgeSourceName: 'Deposit FAQ',
            input: { query: 'deposit posting time' },
            output: { list: [] },
            latencyMs: 40,
          }),
          createdAt: new Date('2026-06-26T00:00:03.400Z'),
        },
        {
          id: 'agentops-smoke-trace-loop-1',
          orgId: SMOKE_ORG_ID,
          caseId: SMOKE_CASE_ID,
          chatId: SMOKE_CHAT_ID,
          runId: SMOKE_RUN_ID,
          actionType: 'loop_decision',
          title: 'Iteration Snapshot',
          detail: null,
          payload: JSON.stringify({ wallMs: 1000, iterationWallMs: 1000, llmWallMs: 800, toolsWallMs: 200 }),
          createdAt: assistantAt,
        },
        {
          id: 'agentops-smoke-trace-hook-1',
          orgId: SMOKE_ORG_ID,
          caseId: SMOKE_CASE_ID,
          chatId: SMOKE_CHAT_ID,
          runId: SMOKE_RUN_ID,
          actionType: 'hook_hit',
          title: 'Hook decision: human handoff promise requires task',
          detail: null,
          payload: JSON.stringify({
            hookName: 'human_handoff_promise_requires_task',
            checkpoint: 'Stop',
            action: 'escalate',
            reason: 'Handoff promise requires a HumanTask.',
          }),
          createdAt: handoffAt,
        },
        {
          id: 'agentops-smoke-trace-human-task-1',
          orgId: SMOKE_ORG_ID,
          caseId: SMOKE_CASE_ID,
          chatId: SMOKE_CHAT_ID,
          runId: SMOKE_RUN_ID,
          actionType: 'human_task_created',
          title: 'Human task created for payment_ops',
          detail: null,
          payload: JSON.stringify({
            queue: 'payment_ops',
            status: 'pending',
            reason: 'Payment operations review required.',
          }),
          createdAt: handoffAt,
        },
      ],
    })

    await tx.humanTask.create({
      data: {
        id: SMOKE_TASK_ID,
        orgId: SMOKE_ORG_ID,
        caseId: SMOKE_CASE_ID,
        chatId: SMOKE_CHAT_ID,
        runId: SMOKE_RUN_ID,
        queue: 'payment_ops',
        status: 'pending',
        question: 'Review the pending CNY 500 deposit and confirm the next customer-facing step.',
        notes: 'AgentOps local smoke fixture.',
        createdAt: handoffAt,
      },
    })
  })
}

function assertRecord(assertions, name, passed, details = {}) {
  assertions.push({ name, passed: Boolean(passed), details })
}

function assertEqual(assertions, name, actual, expected) {
  assertRecord(assertions, name, Object.is(actual, expected), { actual, expected })
}

function assertIncludes(assertions, name, values, expected) {
  assertRecord(assertions, name, Array.isArray(values) && values.includes(expected), { actual: values, expected })
}

function assertNotContains(assertions, name, text, forbidden, details = {}) {
  assertRecord(assertions, name, !text.includes(forbidden), details)
}

function routeStatus(result) {
  return {
    status: result.status,
    envelopeOk: result.json?.ok === true,
    errorCode: result.json?.ok === false ? result.json.error?.code ?? null : null,
  }
}

function buildSmokeMetricsUrl(baseUrl) {
  return buildUrl(baseUrl, `/api/agentops/agents/${encodeURIComponent(SMOKE_AGENT_ID)}/metrics`, {
    window: '1h',
    from: SMOKE_FROM,
    to: SMOKE_TO,
    timezone: DEFAULT_TIMEZONE,
  })
}

function buildSmokeProposalBody(baseDraftFingerprint) {
  return {
    schemaVersion: 'agentops.proposal-create.v1',
    target: { agentId: SMOKE_AGENT_ID },
    baseDraftFingerprint,
    externalAgent: {
      name: SMOKE_EXTERNAL_AGENT_NAME,
      provider: 'local-script',
      runId: 'agentops-local-smoke-run',
    },
    reason: 'Local smoke observed a stable handoff path and proposes a harmless draft-only brain tuning patch.',
    evidenceRefs: [
      `chat:${SMOKE_CHAT_ID}`,
      `case:${SMOKE_CASE_ID}`,
      `procedure-run:${SMOKE_RUN_ID}`,
    ],
    proposal: {
      baseDraftFingerprint,
      targetSurface: 'brain',
      title: SMOKE_PROPOSAL_TITLE,
      summary: 'Draft-only smoke proposal that must not mutate the active Agent config.',
      rationale: 'Exercises the AgentOps proposal intake path with typed ConfigPilot patches.',
      patches: [{
        surface: 'brain',
        operation: 'update',
        fields: { temperature: 0.42 },
      }],
      diffGroups: [],
      receiptSuggestions: [],
      runSuggestions: [],
      safetyNotes: ['Smoke assertion requires active AgentConfig to remain unchanged.'],
    },
  }
}

function buildSmokeReplayBody(overrides = {}) {
  return {
    mode: 'local_dry_run',
    draftAgentConfigId: SMOKE_AGENT_ID,
    source: {
      type: 'observed',
      scenario: {
        name: 'agentops_smoke_deposit_handoff',
        displayName: 'AgentOps smoke deposit handoff',
        turns: [{ role: 'user', content: 'My deposit is missing.' }],
        expected: {},
      },
    },
    observed: {
      toolCalls: [{
        name: 'get_latest_deposit',
        input: { amount: 500, currency: 'CNY', timezone: '+08:00' },
        executionMode: 'mocked',
      }],
      hookDecisions: [{
        hookName: 'human_handoff_promise_requires_task',
        checkpoint: 'Stop',
        toolName: 'get_latest_deposit',
        decision: 'escalate',
      }],
    },
    assertions: [
      {
        id: 'timezone-matches',
        type: 'tool_input_equals',
        toolName: 'get_latest_deposit',
        path: 'timezone',
        expected: '+08:00',
      },
      {
        id: 'handoff-hook-escalates',
        type: 'hook_outcome',
        hookName: 'human_handoff_promise_requires_task',
        checkpoint: 'Stop',
        toolName: 'get_latest_deposit',
        decision: 'escalate',
      },
    ],
    ...overrides,
  }
}

function buildBlockedSmokeReplayBody() {
  return buildSmokeReplayBody({
    observed: {
      toolCalls: [{
        name: 'get_latest_deposit',
        input: { amount: 500, currency: 'CNY', timezone: '+08:00' },
        executionMode: 'runtime',
      }],
      hookDecisions: [],
    },
    assertions: [{
      id: 'runtime-tool-blocked',
      type: 'tool_input_equals',
      toolName: 'get_latest_deposit',
      path: 'timezone',
      expected: '+08:00',
    }],
  })
}

async function getAgentConfigSmokeSnapshot(prisma) {
  const row = await prisma.agentConfig.findUnique({
    where: { id: SMOKE_AGENT_ID },
    select: {
      id: true,
      orgId: true,
      name: true,
      version: true,
      isActive: true,
      temperature: true,
      updatedAt: true,
    },
  })
  if (!row) throw new CliError(`Missing AgentConfig ${SMOKE_AGENT_ID}`)
  return {
    ...row,
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function countSmokePilotProposals(prisma) {
  return prisma.pilotProposal.count({
    where: {
      orgId: SMOKE_ORG_ID,
      baseAgentConfigId: SMOKE_AGENT_ID,
      title: SMOKE_PROPOSAL_TITLE,
    },
  })
}

async function loadSmokeProposalEvidence(prisma, proposalId) {
  const proposal = await prisma.pilotProposal.findFirst({
    where: {
      id: proposalId,
      orgId: SMOKE_ORG_ID,
      baseAgentConfigId: SMOKE_AGENT_ID,
    },
    select: {
      id: true,
      orgId: true,
      sessionId: true,
      status: true,
      title: true,
      patchCount: true,
      baseAgentConfigId: true,
      baseDraftFingerprint: true,
      proposal: true,
      appliedAt: true,
      appliedDraftAgentConfigId: true,
    },
  })
  if (!proposal) return { proposal: null, metadataMessage: null, auditLog: null }

  const [messages, auditLog] = await Promise.all([
    prisma.pilotMessage.findMany({
      where: {
        orgId: SMOKE_ORG_ID,
        sessionId: proposal.sessionId,
        kind: 'trace',
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        kind: true,
        structuredPayload: true,
      },
    }),
    prisma.auditLog.findFirst({
      where: {
        orgId: SMOKE_ORG_ID,
        action: 'agentops.proposal.create',
        target: `pilot_proposal:${proposalId}`,
      },
      select: {
        action: true,
        target: true,
        after: true,
      },
    }),
  ])
  const metadataMessage = messages.find((message) =>
    message.structuredPayload?.source === 'agentops.proposal-create.v1' &&
    message.structuredPayload?.proposalId === proposalId,
  ) ?? null
  return { proposal, metadataMessage, auditLog }
}

async function runSmoke(options) {
  const baseUrl = resolveBaseUrl(options)
  const db = parseDatabaseUrl({ requireStandardPort: true })
  const credentials = loginCredentials()
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const artifactDir = resolve(ROOT, '.artifacts', 'agentops-smoke', timestamp)
  mkdirSync(artifactDir, { recursive: true })

  const summary = {
    schemaVersion: 'agentops.local-smoke.v1',
    generatedAt: new Date().toISOString(),
    artifactDir,
    preflight: {
      baseUrl,
      baseUrlPortCheck: null,
      database: db,
      databasePortCheck: null,
      loginEmail: credentials.email,
      nodeEnv: process.env.NODE_ENV ?? null,
    },
    fixture: {
      orgId: SMOKE_ORG_ID,
      agentId: SMOKE_AGENT_ID,
      wrongAgentId: SMOKE_WRONG_AGENT_ID,
      chatId: SMOKE_CHAT_ID,
      caseId: SMOKE_CASE_ID,
      runId: SMOKE_RUN_ID,
      taskId: SMOKE_TASK_ID,
    },
    results: {
      proposalId: null,
      replayReceiptId: null,
      blockedReplayReceiptId: null,
    },
    routeStatuses: {},
    assertions: [],
    passed: false,
  }

  let prisma = null
  let cookie = null
  try {
    summary.preflight.baseUrlPortCheck = assertLocalConsoleListenerForBaseUrl(baseUrl)
    summary.preflight.databasePortCheck = assertNoSshTunnelForDbPort(db.port)

    const healthResult = await fetchJson(buildUrl(baseUrl, '/api/health'))
    summary.routeStatuses.health = {
      status: healthResult.status,
      appStatus: healthResult.json?.status ?? null,
      db: healthResult.json?.db ?? null,
    }
    if (!healthResult.ok || healthResult.json?.db !== 'connected') {
      throw new CliError(`Local console health check failed with HTTP ${healthResult.status}. Start npm run dev:console before running the full smoke.`)
    }

    prisma = await importPrismaClient()
    await ensureSeededBase(prisma, credentials.email)
    await recreateSmokeFixture(prisma)
    const agentBeforeProposal = await getAgentConfigSmokeSnapshot(prisma)
    const proposalCountBefore = await countSmokePilotProposals(prisma)

    const loginResult = await login(baseUrl)
    cookie = loginResult.cookie
    summary.routeStatuses.login = { status: loginResult.status }

    const metricsResult = await fetchJson(buildSmokeMetricsUrl(baseUrl), { headers: cookieHeaders(cookie) })
    summary.routeStatuses.metrics = routeStatus(metricsResult)
    if (metricsResult.json?.ok === true) {
      assertMetrics(summary.assertions, metricsResult.json.data)
    } else {
      assertRecord(summary.assertions, 'metrics route returns ok envelope', false, routeStatus(metricsResult))
    }

    const forensicResult = await fetchJson(
      buildUrl(
        baseUrl,
        `/api/agentops/agents/${encodeURIComponent(SMOKE_AGENT_ID)}/chats/${encodeURIComponent(SMOKE_CHAT_ID)}/forensic-pack`,
        { translate: 'zh' },
      ),
      { headers: cookieHeaders(cookie) },
    )
    summary.routeStatuses.forensicPack = routeStatus(forensicResult)
    if (forensicResult.json?.ok === true) {
      assertForensicPack(summary.assertions, forensicResult.json.data)
    } else {
      assertRecord(summary.assertions, 'forensic-pack route returns ok envelope', false, routeStatus(forensicResult))
    }

    const contextResult = await fetchJson(
      buildUrl(baseUrl, '/api/admin/config-pilot/context', { agentConfigId: SMOKE_AGENT_ID }),
      { headers: cookieHeaders(cookie) },
    )
    summary.routeStatuses.configPilotContext = routeStatus(contextResult)
    const contextData = contextResult.json?.ok === true
      ? contextResult.json.data
      : null
    if (contextData) {
      assertRecord(
        summary.assertions,
        'config-pilot context returns draft fingerprint',
        typeof contextData.draftFingerprint === 'string' && contextData.draftFingerprint.length > 0,
      )
    } else {
      assertRecord(summary.assertions, 'config-pilot context returns ok envelope', false, routeStatus(contextResult))
    }

    if (contextData?.draftFingerprint) {
      const proposalResult = await fetchJson(
        buildUrl(baseUrl, `/api/agentops/agents/${encodeURIComponent(SMOKE_AGENT_ID)}/proposals`),
        {
          method: 'POST',
          headers: jsonCookieHeaders(cookie),
          body: JSON.stringify(buildSmokeProposalBody(contextData.draftFingerprint)),
        },
      )
      summary.routeStatuses.proposal = routeStatus(proposalResult)
      if (proposalResult.json?.ok === true) {
        const proposalData = proposalResult.json.data
        summary.results.proposalId = proposalData.proposalId
        const [agentAfterProposal, proposalCountAfter, proposalEvidence] = await Promise.all([
          getAgentConfigSmokeSnapshot(prisma),
          countSmokePilotProposals(prisma),
          loadSmokeProposalEvidence(prisma, proposalData.proposalId),
        ])
        assertAgentOpsProposal(summary.assertions, {
          data: proposalData,
          draftFingerprint: contextData.draftFingerprint,
          agentBefore: agentBeforeProposal,
          agentAfter: agentAfterProposal,
          proposalCountBefore,
          proposalCountAfter,
          evidence: proposalEvidence,
        })

        const staleProposalResult = await fetchJson(
          buildUrl(baseUrl, `/api/agentops/agents/${encodeURIComponent(SMOKE_AGENT_ID)}/proposals`),
          {
            method: 'POST',
            headers: jsonCookieHeaders(cookie),
            body: JSON.stringify(buildSmokeProposalBody('b'.repeat(64))),
          },
        )
        summary.routeStatuses.staleProposal = routeStatus(staleProposalResult)
        assertEqual(summary.assertions, 'stale proposal returns 409', staleProposalResult.status, 409)
        const proposalCountAfterStale = await countSmokePilotProposals(prisma)
        assertEqual(
          summary.assertions,
          'stale proposal creates no extra PilotProposal',
          proposalCountAfterStale,
          proposalCountAfter,
        )
      } else {
        assertRecord(summary.assertions, 'proposal route returns ok envelope', false, routeStatus(proposalResult))
      }
    }

    const replayResult = await fetchJson(
      buildUrl(baseUrl, `/api/agentops/agents/${encodeURIComponent(SMOKE_AGENT_ID)}/replay`),
      {
        method: 'POST',
        headers: jsonCookieHeaders(cookie),
        body: JSON.stringify(buildSmokeReplayBody()),
      },
    )
    summary.routeStatuses.replay = routeStatus(replayResult)
    if (replayResult.json?.ok === true) {
      summary.results.replayReceiptId = replayResult.json.data?.receiptId ?? null
      assertReplayReceipt(summary.assertions, replayResult.json.data)
    } else {
      assertRecord(summary.assertions, 'replay route returns ok envelope', false, routeStatus(replayResult))
    }

    const blockedReplayResult = await fetchJson(
      buildUrl(baseUrl, `/api/agentops/agents/${encodeURIComponent(SMOKE_AGENT_ID)}/replay`),
      {
        method: 'POST',
        headers: jsonCookieHeaders(cookie),
        body: JSON.stringify(buildBlockedSmokeReplayBody()),
      },
    )
    summary.routeStatuses.blockedReplay = routeStatus(blockedReplayResult)
    if (blockedReplayResult.json?.ok === true) {
      summary.results.blockedReplayReceiptId = blockedReplayResult.json.data?.receiptId ?? null
      assertBlockedReplayReceipt(summary.assertions, blockedReplayResult.json.data)
    } else {
      assertRecord(summary.assertions, 'blocked replay route returns ok envelope', false, routeStatus(blockedReplayResult))
    }

    const fakeDraftReplayResult = await fetchJson(
      buildUrl(baseUrl, `/api/agentops/agents/${encodeURIComponent(SMOKE_AGENT_ID)}/replay`),
      {
        method: 'POST',
        headers: jsonCookieHeaders(cookie),
        body: JSON.stringify(buildSmokeReplayBody({ draftAgentConfigId: SMOKE_FAKE_AGENT_ID })),
      },
    )
    summary.routeStatuses.fakeDraftReplay = routeStatus(fakeDraftReplayResult)
    assertEqual(summary.assertions, 'fake draft replay returns 404', fakeDraftReplayResult.status, 404)

    const noCookieResult = await fetchJson(buildSmokeMetricsUrl(baseUrl))
    summary.routeStatuses.noCookieMetrics = routeStatus(noCookieResult)
    assertEqual(summary.assertions, 'no-cookie metrics returns 401', noCookieResult.status, 401)

    const wrongAgentForensicResult = await fetchJson(
      buildUrl(
        baseUrl,
        `/api/agentops/agents/${encodeURIComponent(SMOKE_WRONG_AGENT_ID)}/chats/${encodeURIComponent(SMOKE_CHAT_ID)}/forensic-pack`,
      ),
      { headers: cookieHeaders(cookie) },
    )
    summary.routeStatuses.wrongAgentForensicPack = routeStatus(wrongAgentForensicResult)
    assertEqual(summary.assertions, 'wrong-agent forensic-pack returns 404', wrongAgentForensicResult.status, 404)

    const fakeAgentResult = await fetchJson(
      buildUrl(baseUrl, `/api/agentops/agents/${encodeURIComponent(SMOKE_FAKE_AGENT_ID)}/metrics`, {
        window: '1h',
        from: SMOKE_FROM,
        to: SMOKE_TO,
        timezone: DEFAULT_TIMEZONE,
      }),
      { headers: cookieHeaders(cookie) },
    )
    summary.routeStatuses.fakeAgentMetrics = routeStatus(fakeAgentResult)
    assertEqual(summary.assertions, 'fake-agent metrics returns 404', fakeAgentResult.status, 404)

    summary.passed = summary.assertions.every((assertion) => assertion.passed)
  } catch (error) {
    summary.error = error instanceof Error ? error.message : String(error)
    summary.passed = false
  } finally {
    if (prisma) await prisma.$disconnect()
  }

  const summaryPath = resolve(artifactDir, 'summary.json')
  const summaryJson = JSON.stringify(summary, null, 2)
  assertSummaryIsSanitized(summaryJson, {
    password: credentials.password,
    cookieValue: cookie?.value,
    databaseUrl: process.env.DATABASE_URL,
  })
  writeFileSync(summaryPath, `${summaryJson}\n`)

  if (!summary.passed) {
    const failed = summary.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.name)
    const suffix = failed.length > 0 ? ` Failed assertions: ${failed.join('; ')}` : ''
    throw new CliError(`AgentOps smoke failed. Summary: ${summaryPath}.${suffix}`)
  }

  console.log(`AgentOps smoke passed. Summary: ${summaryPath}`)
}

function assertMetrics(assertions, data) {
  assertEqual(assertions, 'metrics agentId matches fixture', data.agentId, SMOKE_AGENT_ID)
  assertEqual(assertions, 'metrics scope agentConfigId matches fixture', data.scope?.agentConfigId, SMOKE_AGENT_ID)
  assertIncludes(assertions, 'metrics scope includes smoke case', data.scope?.caseIds, SMOKE_CASE_ID)
  assertIncludes(assertions, 'metrics scope includes smoke run', data.scope?.runIds, SMOKE_RUN_ID)
  assertEqual(assertions, 'handoff numerator is 1', data.metrics?.handoffRate?.numerator, 1)
  assertEqual(assertions, 'handoff denominator is 1', data.metrics?.handoffRate?.denominator, 1)
  assertEqual(assertions, 'handoff value is 1', data.metrics?.handoffRate?.value, 1)
  assertEqual(assertions, 'active human task count is 1', data.metrics?.handoffRate?.activeHumanTasks, 1)
  assertEqual(assertions, 'tool result count is 2', data.metrics?.toolErrorRate?.observedToolResults, 2)
  assertEqual(assertions, 'tool error count is 0', data.metrics?.toolErrorRate?.errorCount, 0)
  assertEqual(assertions, 'knowledge miss numerator is 1', data.metrics?.knowledgeMissRate?.numerator, 1)
  assertEqual(assertions, 'knowledge miss denominator is 1', data.metrics?.knowledgeMissRate?.denominator, 1)
  assertEqual(assertions, 'token total is 160', data.metrics?.tokenSummary?.totalTokens, 160)
  assertEqual(assertions, 'token input includes cache read', data.metrics?.tokenSummary?.inputTokens, 110)
  assertEqual(assertions, 'latency first response average is 3000ms', data.metrics?.latency?.firstResponseMs?.average, 3000)
  assertEqual(assertions, 'latency trace wall average is 1000ms', data.metrics?.latency?.traceWallMs?.average, 1000)
  assertEqual(assertions, 'cost amount is null', data.metrics?.cost?.amount, null)
  assertEqual(assertions, 'cost currency is null', data.metrics?.cost?.currency, null)
  assertEqual(assertions, 'cost is unavailable', data.metrics?.cost?.available, false)
  assertIncludes(assertions, 'coverage includes procedure_run attribution', data.coverage?.attributionModes, 'procedure_run')
}

function assertForensicPack(assertions, data) {
  assertEqual(assertions, 'forensic schema version matches', data.schemaVersion, 'agentops.forensic-pack.v1')
  assertEqual(assertions, 'forensic attribution is procedure_run', data.attribution?.status, 'procedure_run')
  assertEqual(assertions, 'forensic transcript visible count is 2', data.transcript?.totalVisibleMessages, 2)
  assertEqual(assertions, 'forensic omitted internal count is 1', data.transcript?.omittedInternalMessages, 1)
  assertIncludes(assertions, 'forensic procedureRuns includes smoke run', data.procedureRuns?.map((run) => run.runId), SMOKE_RUN_ID)
  assertRecord(
    assertions,
    'forensic transcript rows carry smoke run id',
    Array.isArray(data.transcript?.messages) && data.transcript.messages.every((message) => message.runId === SMOKE_RUN_ID),
  )
  assertIncludes(assertions, 'forensic tools include get_latest_deposit', data.evidence?.tools?.map((tool) => tool.name), 'get_latest_deposit')
  assertIncludes(assertions, 'forensic tools include kb_search_deposit', data.evidence?.tools?.map((tool) => tool.name), 'kb_search_deposit')
  assertRecord(
    assertions,
    'forensic knowledge evidence records miss',
    Array.isArray(data.evidence?.knowledge) &&
      data.evidence.knowledge.some((item) => item.toolName === 'kb_search_deposit' && item.hitCount === 0 && item.miss === true),
  )
  assertRecord(
    assertions,
    'forensic hook evidence records handoff hook',
    Array.isArray(data.evidence?.hooks) &&
      data.evidence.hooks.some((hook) => hook.hookName === 'human_handoff_promise_requires_task' && hook.checkpoint === 'Stop'),
  )
  assertRecord(
    assertions,
    'forensic human task evidence records payment_ops handoff',
    Array.isArray(data.evidence?.humanTasks) &&
      data.evidence.humanTasks.some((task) => task.queue === 'payment_ops' && task.status === 'pending'),
  )
  assertEqual(assertions, 'forensic token usage total is 160', data.metrics?.usage?.totalTokens, 160)
  assertEqual(assertions, 'forensic first response latency is 3000ms', data.metrics?.latency?.firstResponseMs, 3000)
  assertEqual(assertions, 'forensic cost is null', data.metrics?.cost, null)
  assertRecord(
    assertions,
    'forensic omissions include debug provider fields',
    Array.isArray(data.omissions) && data.omissions.some((item) => item.field === 'providerContent/providerMeta'),
  )
  assertRecord(
    assertions,
    'forensic omissions include translation acknowledgement',
    Array.isArray(data.omissions) && data.omissions.some((item) => item.field === 'translatedTranscript'),
  )

  const json = JSON.stringify(data)
  for (const [index, sentinel] of INTERNAL_SENTINELS.entries()) {
    assertNotContains(
      assertions,
      `forensic pack omits internal sentinel ${index + 1}`,
      json,
      sentinel,
      { sentinelIndex: index + 1 },
    )
  }
}

function assertAgentOpsProposal(assertions, input) {
  const {
    data,
    draftFingerprint,
    agentBefore,
    agentAfter,
    proposalCountBefore,
    proposalCountAfter,
    evidence,
  } = input
  const proposal = evidence.proposal
  const metadata = evidence.metadataMessage?.structuredPayload ?? null
  const metadataRefs = Array.isArray(metadata?.evidenceRefs) ? metadata.evidenceRefs : []
  const metadataJson = JSON.stringify(metadata ?? {})

  assertEqual(assertions, 'proposal status is drafted', data.status, 'drafted')
  assertEqual(assertions, 'proposal response fingerprint matches context', data.baseDraftFingerprint, draftFingerprint)
  assertEqual(assertions, 'proposal activeAgentConfigUnchanged is true', data.activeAgentConfigUnchanged, true)
  assertEqual(assertions, 'proposal count increments by one', proposalCountAfter, proposalCountBefore + 1)
  assertEqual(assertions, 'proposal record exists', Boolean(proposal), true)
  assertEqual(assertions, 'proposal record is drafted', proposal?.status, 'drafted')
  assertEqual(assertions, 'proposal record title matches smoke title', proposal?.title, SMOKE_PROPOSAL_TITLE)
  assertEqual(assertions, 'proposal record base agent matches fixture', proposal?.baseAgentConfigId, SMOKE_AGENT_ID)
  assertEqual(assertions, 'proposal record fingerprint matches context', proposal?.baseDraftFingerprint, draftFingerprint)
  assertEqual(assertions, 'proposal record patch count is 1', proposal?.patchCount, 1)
  assertEqual(assertions, 'proposal record not applied', proposal?.appliedAt, null)
  assertEqual(assertions, 'proposal record has no applied draft id', proposal?.appliedDraftAgentConfigId, null)
  assertEqual(assertions, 'active AgentConfig unchanged after proposal', JSON.stringify(agentAfter), JSON.stringify(agentBefore))
  assertEqual(assertions, 'AgentOps metadata message recorded', Boolean(evidence.metadataMessage), true)
  assertEqual(assertions, 'AgentOps metadata source version recorded', metadata?.source, 'agentops.proposal-create.v1')
  assertEqual(assertions, 'AgentOps metadata external agent recorded', metadata?.externalAgent?.name, SMOKE_EXTERNAL_AGENT_NAME)
  assertIncludes(assertions, 'AgentOps metadata includes chat ref', metadataRefs, `chat:${SMOKE_CHAT_ID}`)
  assertIncludes(assertions, 'AgentOps metadata includes procedure run ref', metadataRefs, `procedure-run:${SMOKE_RUN_ID}`)
  assertRecord(
    assertions,
    'AgentOps metadata evidence is refs-only',
    metadataRefs.length === 3 && metadataRefs.every((ref) => /^[a-z][a-z0-9_.-]{1,31}:[A-Za-z0-9_./:@#-]{1,128}$/.test(ref)),
  )
  assertEqual(assertions, 'AgentOps proposal audit exists', evidence.auditLog?.action, 'agentops.proposal.create')

  for (const [index, sentinel] of INTERNAL_SENTINELS.entries()) {
    assertNotContains(
      assertions,
      `proposal metadata omits internal sentinel ${index + 1}`,
      metadataJson,
      sentinel,
      { sentinelIndex: index + 1 },
    )
  }
}

function assertReplayReceipt(assertions, data) {
  assertEqual(assertions, 'replay schema version matches', data.schemaVersion, 'agentops.replay-receipt.v1')
  assertEqual(assertions, 'replay status is pass', data.status, 'pass')
  assertEqual(assertions, 'replay mode is local_dry_run', data.mode, 'local_dry_run')
  assertEqual(assertions, 'replay agentId matches fixture', data.agentId, SMOKE_AGENT_ID)
  assertEqual(assertions, 'replay draftAgentConfigId matches fixture', data.draftAgentConfigId, SMOKE_AGENT_ID)
  assertEqual(assertions, 'replay external tool calls false', data.toolSafety?.externalToolCalls, false)
  assertEqual(assertions, 'replay runtime tool execution false', data.toolSafety?.runtimeToolExecution, false)
  assertEqual(assertions, 'replay provider calls false', data.toolSafety?.providerCalls, false)
  assertEqual(assertions, 'replay side effects false', data.toolSafety?.sideEffects, false)
  assertEqual(assertions, 'replay production runtime false', data.toolSafety?.productionRuntimeReplay, false)
  assertEqual(assertions, 'replay appends no Scenario receipts', data.toolSafety?.scenarioReceiptsAppended, false)
  assertEqual(assertions, 'replay marks no Scenario validation', data.toolSafety?.scenarioValidationMarkedValidated, false)
  assertEqual(assertions, 'observed replay has no scenario receipt write summary', data.scenarioReceipt, null)
  assertRecord(
    assertions,
    'replay assertions all pass',
    Array.isArray(data.assertions) &&
      data.assertions.length === 2 &&
      data.assertions.every((assertion) => assertion.status === 'pass' && assertion.passed === true),
  )
}

function assertBlockedReplayReceipt(assertions, data) {
  assertEqual(assertions, 'blocked replay schema version matches', data.schemaVersion, 'agentops.replay-receipt.v1')
  assertEqual(assertions, 'blocked replay status is blocked', data.status, 'blocked')
  assertEqual(assertions, 'blocked replay external tool calls true', data.toolSafety?.externalToolCalls, true)
  assertEqual(assertions, 'blocked replay runtime tool execution remains false', data.toolSafety?.runtimeToolExecution, false)
  assertEqual(assertions, 'blocked replay provider calls false', data.toolSafety?.providerCalls, false)
  assertEqual(assertions, 'blocked replay side effects false', data.toolSafety?.sideEffects, false)
  assertEqual(assertions, 'blocked replay appends no Scenario receipts', data.toolSafety?.scenarioReceiptsAppended, false)
  assertEqual(assertions, 'blocked replay marks no Scenario validation', data.toolSafety?.scenarioValidationMarkedValidated, false)
  assertRecord(
    assertions,
    'blocked replay assertions are blocked',
    Array.isArray(data.assertions) &&
      data.assertions.length === 1 &&
      data.assertions[0]?.status === 'blocked' &&
      data.assertions[0]?.passed === false,
  )
}

function assertSummaryIsSanitized(summaryJson, secrets) {
  const leaked = []
  for (const [name, value] of Object.entries(secrets)) {
    if (value && summaryJson.includes(value)) leaked.push(name)
  }
  for (const marker of FORBIDDEN_SUMMARY_MARKERS) {
    if (summaryJson.includes(marker)) leaked.push(`marker:${marker}`)
  }
  if (leaked.length > 0) {
    throw new CliError(`Refusing to write smoke summary containing sensitive values: ${leaked.join(', ')}`)
  }
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2))
  if (command === 'help') {
    console.log(usage())
    return
  }
  if (command === 'metrics') {
    await runMetrics(options)
    return
  }
  if (command === 'forensic-pack') {
    await runForensicPack(options)
    return
  }
  if (command === 'smoke') {
    await runSmoke(options)
    return
  }
  throw new CliError(`Unknown command: ${command}\n\n${usage()}`)
}

main().catch((error) => {
  if (error instanceof CliError) {
    console.error(error.message)
    process.exit(error.exitCode)
  }
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
