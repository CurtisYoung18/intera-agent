#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = process.cwd()
const DEFAULT_BASE_URL = 'https://demo.anytrans.ai'
const DEFAULT_TIME_ZONE = process.env.PRODUCTION_READINESS_TZ || 'Asia/Shanghai'

const args = new Set(process.argv.slice(2))
if (args.has('--help')) {
  console.log(`Usage: npm run check:production-readiness

Creates a production-readiness receipt under .artifacts/production-readiness/<date>/<run-id>/.

Environment:
  PRODUCTION_BASE_URL              Public production URL. Defaults to ${DEFAULT_BASE_URL}.
  PRODUCTION_AUTH_COOKIE           Optional raw Cookie header for authenticated metrics proof.
  PRODUCTION_RUNTIME_INTERNAL_URL  Optional host-local runtime URL, e.g. http://127.0.0.1:3101.
  INTERNAL_API_SECRET              Required only with PRODUCTION_RUNTIME_INTERNAL_URL.
  PRODUCTION_READINESS_DATE        Override the date folder.
  PRODUCTION_READINESS_RUN_ID      Override the run folder.
  PRODUCTION_READINESS_SKIP_AUDIT  Set to 1 to skip npm audit --omit=dev.
`)
  process.exit(0)
}

const startedAt = new Date()
const date = process.env.PRODUCTION_READINESS_DATE || formatDate(startedAt, DEFAULT_TIME_ZONE)
const runId = process.env.PRODUCTION_READINESS_RUN_ID || formatRunId(startedAt, DEFAULT_TIME_ZONE)
const outDir = resolve(ROOT, '.artifacts', 'production-readiness', date, runId)
mkdirSync(outDir, { recursive: true })

const baseUrl = normalizeBaseUrl(process.env.PRODUCTION_BASE_URL || process.env.PROD_BASE_URL || DEFAULT_BASE_URL)
const authCookie = process.env.PRODUCTION_AUTH_COOKIE || ''
const runtimeInternalUrl = normalizeBaseUrl(process.env.PRODUCTION_RUNTIME_INTERNAL_URL || '')
const internalSecret = process.env.INTERNAL_API_SECRET || ''
const skipAudit = process.env.PRODUCTION_READINESS_SKIP_AUDIT === '1'

const checks = []
checks.push(await checkPublicHealth(baseUrl))
checks.push(await checkPublicInternalIsBlocked(baseUrl))
checks.push(await checkUnauthenticatedMetricsProtected(baseUrl))
if (authCookie) {
  checks.push(await checkAuthenticatedMetrics(baseUrl, authCookie))
} else {
  checks.push(skippedCheck(
    'authenticated-operate-metrics',
    'Set PRODUCTION_AUTH_COOKIE to prove /api/operate/procedures/metrics with an authenticated session.',
  ))
}
if (runtimeInternalUrl) {
  checks.push(await checkRuntimeInternalHealth(runtimeInternalUrl, internalSecret))
} else {
  checks.push(skippedCheck(
    'runtime-internal-health',
    'Set PRODUCTION_RUNTIME_INTERNAL_URL and INTERNAL_API_SECRET when running on the production host.',
  ))
}
if (skipAudit) {
  checks.push(skippedCheck('production-dependency-audit', 'Skipped because PRODUCTION_READINESS_SKIP_AUDIT=1.'))
} else {
  checks.push(await checkProductionAudit())
}

const summary = {
  status: overallStatus(checks),
  statusMeaning: statusMeaning(overallStatus(checks)),
  baseUrl,
  runtimeInternalUrl: runtimeInternalUrl || null,
  startedAt: startedAt.toISOString(),
  completedAt: new Date().toISOString(),
  outputDir: relative(ROOT, outDir),
  checks,
  blockers: checks.filter((check) => check.status === 'fail'),
  skipped: checks.filter((check) => check.status === 'skipped'),
}

writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
writeFileSync(join(outDir, 'summary.md'), renderSummary(summary))

console.log(JSON.stringify({
  ok: summary.status === 'pass',
  status: summary.status,
  outputDir: summary.outputDir,
  checks: checks.map((check) => ({ name: check.name, status: check.status })),
  blockers: summary.blockers.map((check) => ({ name: check.name, detail: check.detail })),
}, null, 2))

if (summary.status === 'fail') process.exit(1)

export function normalizeBaseUrl(raw) {
  return String(raw || '').trim().replace(/\/+$/, '')
}

export function isPublicInternalBlockedStatus(status) {
  return [401, 403, 404, 405].includes(status)
}

export function isProtectedUnauthenticatedStatus(status) {
  return [302, 303, 307, 308, 401, 403].includes(status)
}

export function overallStatus(checks) {
  return checks.some((check) => check.status === 'fail') ? 'fail' : 'pass'
}

function statusMeaning(status) {
  return status === 'pass'
    ? 'No blocking production-readiness failures were found. Skipped checks still require separate evidence before final acceptance.'
    : 'At least one blocking production-readiness check failed.'
}

async function checkPublicHealth(baseUrl) {
  const url = `${baseUrl}/api/health`
  const result = await fetchJson(url)
  const dbConnected = result.json?.db === 'connected'
  const ok = result.status === 200 && dbConnected
  return {
    name: 'public-health',
    status: ok ? 'pass' : 'fail',
    url,
    httpStatus: result.status,
    detail: ok
      ? 'Production health is reachable and DB is connected.'
      : `Expected HTTP 200 with db=connected, got status=${result.status} body=${safeJson(result.json)}`,
    response: redactBody(result.json),
  }
}

async function checkPublicInternalIsBlocked(baseUrl) {
  const url = `${baseUrl}/internal/health`
  const result = await fetchJson(url)
  const ok = isPublicInternalBlockedStatus(result.status)
  return {
    name: 'public-internal-route-blocked',
    status: ok ? 'pass' : 'fail',
    url,
    httpStatus: result.status,
    detail: ok
      ? 'Public /internal/health is not exposed.'
      : `Public /internal/health returned ${result.status}; internal runtime endpoints must not be public.`,
    response: redactBody(result.json),
  }
}

async function checkUnauthenticatedMetricsProtected(baseUrl) {
  const url = `${baseUrl}/api/operate/procedures/metrics`
  const result = await fetchJson(url, { redirect: 'manual' })
  const ok = isProtectedUnauthenticatedStatus(result.status)
  return {
    name: 'unauthenticated-operate-metrics-protected',
    status: ok ? 'pass' : 'fail',
    url,
    httpStatus: result.status,
    detail: ok
      ? 'Procedure metrics API is protected without an authenticated session.'
      : `Expected protected response, got HTTP ${result.status}.`,
    response: redactBody(result.json),
  }
}

async function checkAuthenticatedMetrics(baseUrl, cookie) {
  const url = `${baseUrl}/api/operate/procedures/metrics`
  const result = await fetchJson(url, {
    headers: { cookie },
  })
  const metrics = result.json?.data?.metrics
  const ok = result.status === 200 && metrics && Array.isArray(metrics.rows)
  return {
    name: 'authenticated-operate-metrics',
    status: ok ? 'pass' : 'fail',
    url,
    httpStatus: result.status,
    detail: ok
      ? `Authenticated Procedure metrics shape is valid with ${metrics.rows.length} row(s).`
      : `Expected authenticated metrics response with data.metrics.rows, got status=${result.status} body=${safeJson(result.json)}`,
    response: ok
      ? {
        totalRuns: metrics.totalRuns,
        rowCount: metrics.rows.length,
        generatedAt: metrics.generatedAt,
      }
      : redactBody(result.json),
  }
}

async function checkRuntimeInternalHealth(runtimeUrl, secret) {
  const url = `${runtimeUrl}/internal/health`
  if (!secret) {
    return {
      name: 'runtime-internal-health',
      status: 'fail',
      url,
      detail: 'PRODUCTION_RUNTIME_INTERNAL_URL is set but INTERNAL_API_SECRET is missing.',
    }
  }
  const result = await fetchJson(url, {
    headers: { 'x-intera-internal': secret },
  })
  const ok = result.status === 200 && result.json?.status === 'ok'
  return {
    name: 'runtime-internal-health',
    status: ok ? 'pass' : 'fail',
    url,
    httpStatus: result.status,
    detail: ok
      ? 'Runtime internal health is reachable from the host-local/internal URL.'
      : `Expected runtime status=ok, got status=${result.status} body=${safeJson(result.json)}`,
    response: redactBody(result.json),
  }
}

async function checkProductionAudit() {
  const result = await runCommand('npm', ['audit', '--omit=dev', '--json'])
  let audit = null
  try {
    audit = JSON.parse(result.stdout || '{}')
  } catch {
    return {
      name: 'production-dependency-audit',
      status: 'fail',
      command: result.command,
      detail: 'npm audit output was not valid JSON.',
      stdout: result.stdout.slice(0, 2000),
      stderr: result.stderr.slice(0, 2000),
    }
  }

  const vulnerabilities = audit.metadata?.vulnerabilities ?? {}
  const high = Number(vulnerabilities.high ?? 0)
  const critical = Number(vulnerabilities.critical ?? 0)
  const ok = high === 0 && critical === 0
  return {
    name: 'production-dependency-audit',
    status: ok ? 'pass' : 'fail',
    command: result.command,
    exitCode: result.code,
    detail: ok
      ? `No high/critical production advisories. Moderate=${vulnerabilities.moderate ?? 0}.`
      : `High=${high}, critical=${critical}; production dependency audit is blocking.`,
    vulnerabilities,
  }
}

async function fetchJson(url, init = {}) {
  try {
    const response = await fetch(url, init)
    const text = await response.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = { raw: text.slice(0, 1000) }
    }
    return { status: response.status, json }
  } catch (err) {
    return {
      status: 0,
      json: { error: err instanceof Error ? err.message : String(err) },
    }
  }
}

function skippedCheck(name, detail) {
  return { name, status: 'skipped', detail }
}

function runCommand(command, args) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('close', (code) => {
      resolveResult({
        code: code ?? 0,
        command: [command, ...args].join(' '),
        stdout,
        stderr,
      })
    })
  })
}

function safeJson(value) {
  try {
    return JSON.stringify(redactBody(value))
  } catch {
    return String(value)
  }
}

function redactBody(value) {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(redactBody).slice(0, 10)
  const redacted = {}
  for (const [key, entry] of Object.entries(value)) {
    if (/token|secret|password|cookie|authorization/i.test(key)) {
      redacted[key] = '[redacted]'
    } else if (typeof entry === 'object' && entry !== null) {
      redacted[key] = redactBody(entry)
    } else {
      redacted[key] = entry
    }
  }
  return redacted
}

function renderSummary(summary) {
  const lines = [
    '# Production Readiness Check',
    '',
    `- Status: ${summary.status}`,
    `- Base URL: ${summary.baseUrl}`,
    `- Runtime internal URL: ${summary.runtimeInternalUrl || 'not configured'}`,
    `- Started: ${summary.startedAt}`,
    `- Completed: ${summary.completedAt}`,
    '',
    '## Checks',
    '',
    ...summary.checks.flatMap((check) => [
      `- ${check.status.toUpperCase()} ${check.name}: ${check.detail}`,
    ]),
  ]
  if (summary.blockers.length > 0) {
    lines.push('', '## Blockers', '')
    for (const blocker of summary.blockers) {
      lines.push(`- ${blocker.name}: ${blocker.detail}`)
    }
  }
  if (summary.skipped.length > 0) {
    lines.push('', '## Skipped Evidence', '')
    for (const skipped of summary.skipped) {
      lines.push(`- ${skipped.name}: ${skipped.detail}`)
    }
  }
  return `${lines.join('\n')}\n`
}

function formatDate(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${map.year}-${map.month}-${map.day}`
}

function formatRunId(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${map.hour}${map.minute}${map.second}`
}
