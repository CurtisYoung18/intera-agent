#!/usr/bin/env node

import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'

const ROOT = process.cwd()
const DEFAULT_TIME_ZONE = process.env.CI_RECEIPTS_TZ || 'Asia/Shanghai'

const args = new Set(process.argv.slice(2))
if (args.has('--help')) {
  console.log(`Usage: npm run ci:receipts

Creates a dated CI receipt bundle under .artifacts/ci/<date>/<run-id>/.

Environment:
  CI_RECEIPTS_DATE           Override the date folder, e.g. 2026-06-12.
  CI_RECEIPTS_RUN_ID         Override the unique run folder.
  CI_RECEIPTS_TEMPLATE_GLOB  Directory containing *.intera-agent.json packages.
  CI_RECEIPTS_SKIP_SMOKE     Set to 1 to skip Playwright screenshots.
  CI_RECEIPTS_ALLOW_PARTIAL  Set to 1 to write a bundle even when a phase fails.
  CI_RECEIPTS_RUN_API        Set to 1 to call Scenario run APIs on an auth-capable host.
  CI_RECEIPTS_BASE_URL       Base URL for API mode; defaults to SMOKE_BASE_URL.
  CI_RECEIPTS_HEALTH_TIMEOUT_MS
                            Health preflight timeout for screenshot runs; default 5000.
`)
  process.exit(0)
}

const startedAt = new Date()
const date = process.env.CI_RECEIPTS_DATE || formatDate(startedAt, DEFAULT_TIME_ZONE)
const runId = process.env.CI_RECEIPTS_RUN_ID || formatRunId(startedAt, DEFAULT_TIME_ZONE)
const bundleDir = resolve(ROOT, '.artifacts', 'ci', date, runId)
const deliveryDir = resolve(ROOT, '.artifacts', 'delivery-audit', date, 'cons-m7a', runId)
const scenarioDir = join(bundleDir, 'scenario-receipts')
const screenshotDir = join(bundleDir, 'screenshots')
const logsDir = join(bundleDir, 'logs')
const tempDir = join(bundleDir, 'tmp')
const allowPartial = process.env.CI_RECEIPTS_ALLOW_PARTIAL === '1'
const skipSmoke = process.env.CI_RECEIPTS_SKIP_SMOKE === '1'
const runApi = process.env.CI_RECEIPTS_RUN_API === '1'

for (const dir of [bundleDir, deliveryDir, scenarioDir, screenshotDir, logsDir, tempDir]) {
  mkdirSync(dir, { recursive: true })
}

const phases = []
const templates = findTemplateFiles()

writeJson(join(bundleDir, 'configured-templates.json'), {
  generatedAt: startedAt.toISOString(),
  templateCount: templates.length,
  templates: templates.map((file) => relative(ROOT, file)),
})

if (templates.length === 0) {
  phases.push({
    name: 'template-discovery',
    status: 'fail',
    detail: 'No configured agent templates found.',
  })
} else {
  phases.push({
    name: 'template-discovery',
    status: 'pass',
    detail: `Found ${templates.length} configured agent template(s).`,
  })
}

if (templates.length > 0) {
  const testFile = writeRuntimeRunnerSuite(templates)
  const result = await runCommand('npx', ['vitest', 'run', testFile], {
    env: {
      CI_RECEIPTS_BUNDLE_DIR: bundleDir,
      CI_RECEIPTS_TEMPLATE_FILES: JSON.stringify(templates),
    },
    logName: 'runtime-runner-vitest',
  })
  rmSync(testFile, { force: true })
  phases.push({
    name: 'runtime-runner-headless',
    status: result.code === 0 ? 'pass' : 'fail',
    command: result.command,
    log: relative(ROOT, result.logPath),
    detail: result.code === 0
      ? 'Runtime-runner headless receipts generated for configured template scenarios.'
      : `Runtime-runner headless suite exited ${result.code}.`,
  })
}

if (runApi) {
  const apiResult = await runApiScenarioReceipts(templates)
  phases.push(apiResult)
}

if (skipSmoke) {
  phases.push({
    name: 'playwright-golden-loop-screenshots',
    status: 'skipped',
    gate: 'golden-loop-screenshots',
    detail: 'Not evaluated because CI_RECEIPTS_SKIP_SMOKE=1. This runtime-only bundle is useful scheduling proof, but it does not satisfy the screenshot gate.',
  })
} else {
  const preflight = await inspectScreenshotEnvironment()
  const result = await runCommand('node', ['scripts/smoke-console-auth.mjs'], {
    env: {
      SMOKE_OUTPUT_DIR: screenshotDir,
    },
    logName: 'smoke-console-auth',
  })
  const blocked = result.code !== 0 && preflight.blockers.length > 0
  phases.push({
    name: 'playwright-golden-loop-screenshots',
    status: result.code === 0 ? 'pass' : blocked ? 'blocked' : 'fail',
    gate: 'golden-loop-screenshots',
    command: result.command,
    log: relative(ROOT, result.logPath),
    detail: result.code === 0
      ? 'Existing authenticated console smoke captured Pilot Lab, Procedure editor, Operate, and adjacent route screenshots.'
      : blocked
        ? `Blocked before authenticated screenshots: ${preflight.blockers.join('; ')}. Fix the host auth/DB/dev-server prerequisites, then rerun npm run ci:receipts.`
        : `Existing authenticated console smoke exited ${result.code}. Inspect the smoke log for route, console, overflow, or screenshot failures.`,
    preflight,
    screenshots: listFiles(screenshotDir, '.png').map((file) => relative(ROOT, file)),
    smokeSummary: existsSync(join(screenshotDir, 'summary.json'))
      ? relative(ROOT, join(screenshotDir, 'summary.json'))
      : null,
  })
}

const completedAt = new Date()
const status = bundleStatus(phases)
const gateStatus = buildGateStatus(phases)

const summary = {
  lane: 'CONS-M7A',
  status,
  statusMeaning: statusMeaning(status),
  startedAt: startedAt.toISOString(),
  completedAt: completedAt.toISOString(),
  bundleDir: relative(ROOT, bundleDir),
  deliveryReceiptDir: relative(ROOT, deliveryDir),
  tasks: taskPlan(),
  phases,
  gateStatus,
  blockers: phases
    .filter((phase) => phase.status === 'blocked' || phase.status === 'fail')
    .map((phase) => ({ phase: phase.name, status: phase.status, detail: phase.detail })),
  receipts: listFiles(scenarioDir, '.json').map((file) => relative(ROOT, file)),
  screenshots: listFiles(screenshotDir, '.png').map((file) => relative(ROOT, file)),
  gates: {
    runtimeReceipts: gateStatus.runtimeReceipts,
    goldenLoopScreenshots: gateStatus.goldenLoopScreenshots,
    twoDatedBundlesProducedUnattended: 'operator verifies with two scheduled full runs; runtime-only skipped screenshot bundles are partial scheduling proof only',
    runbookUpdated: 'doc/handoffs/BROWSER_SMOKE_RUNBOOK.md',
    zeroRuntimeCodeChanges: 'script/package/runbook/deploy/artifact files only',
  },
}

writeJson(join(bundleDir, 'summary.json'), summary)
writeFileSync(join(bundleDir, 'summary.md'), renderSummary(summary))
writeJson(join(deliveryDir, 'summary.json'), summary)
writeFileSync(join(deliveryDir, 'summary.md'), renderSummary(summary))

console.log(JSON.stringify({
  ok: status === 'pass',
  status,
  bundleDir: relative(ROOT, bundleDir),
  deliveryReceiptDir: relative(ROOT, deliveryDir),
  phases: phases.map((phase) => ({ name: phase.name, status: phase.status })),
  blockers: summary.blockers,
}, null, 2))

if (status !== 'pass' && !allowPartial) process.exit(1)

function findTemplateFiles() {
  const configured = process.env.CI_RECEIPTS_TEMPLATE_GLOB || 'templates'
  const root = resolve(ROOT, configured)
  if (!existsSync(root)) return []
  return walk(root)
    .filter((file) => file.endsWith('.intera-agent.json'))
    .sort()
}

function walk(dir) {
  const entries = readdirSync(dir)
  const files = []
  for (const entry of entries) {
    const file = join(dir, entry)
    const stats = statSync(file)
    if (stats.isDirectory()) files.push(...walk(file))
    if (stats.isFile()) files.push(file)
  }
  return files
}

function writeRuntimeRunnerSuite(templateFiles) {
  const testFile = join(tempDir, 'runtime-runner-ci.test.ts')
  const source = `import { describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { runScenarioAgentRuntime } from '@/lib/scenarios/runtime-runner'
import type { SavedScenario } from '@intera/shared/contracts/scenarios'

const bundleDir = process.env.CI_RECEIPTS_BUNDLE_DIR
if (!bundleDir) throw new Error('CI_RECEIPTS_BUNDLE_DIR is required')

const receiptDir = resolve(bundleDir, 'scenario-receipts')
mkdirSync(receiptDir, { recursive: true })

const templateFiles = JSON.parse(process.env.CI_RECEIPTS_TEMPLATE_FILES || '[]') as string[]

describe('CONS-M7A runtime-runner CI receipts', () => {
  for (const templateFile of templateFiles) {
    const template = JSON.parse(readFileSync(templateFile, 'utf8')) as Record<string, any>
    const templateId = String(template.metadata?.templateId || basename(templateFile, '.intera-agent.json'))
    const scenarios = collectScenarios(template)

    describe(templateId, () => {
      for (const scenarioInput of scenarios) {
        it('builds an agentRuntime receipt for ' + scenarioInput.name, async () => {
          const scenario = normalizeScenario(templateId, scenarioInput)
          const receipt = await runScenarioAgentRuntime(scenario, {
            orgId: 'ci-template-org',
            agentConfigId: scenario.agentConfigId,
            userId: 'ci-receipts',
            execute: async () => ({
              toolExecutionMode: 'mocked',
              traceId: 'ci-' + templateId + '-' + scenario.name,
              evidence: buildEvidence(templateId, scenario),
            }),
          })

          expect(receipt.executionMode).toBe('agentRuntime')
          expect(receipt.scenarioName).toBe(scenario.name)
          expect(receipt.status).not.toBe('blocked')

          writeFileSync(
            resolve(receiptDir, templateId + '--' + scenario.name + '.json'),
            JSON.stringify({ templateId, templateFile, receipt }, null, 2) + '\\n',
          )
        })
      }
    })
  }
})

function collectScenarios(template: Record<string, any>): Array<Record<string, any>> {
  const byName = new Map<string, Record<string, any>>()
  for (const scenario of [...(template.scenarioDefinitions || []), ...(template.scenarios || [])]) {
    if (scenario?.enabled === false) continue
    if (typeof scenario?.name === 'string') byName.set(scenario.name, scenario)
  }
  if (byName.size === 0) throw new Error('Template has no enabled scenarios.')
  return [...byName.values()]
}

function normalizeScenario(templateId: string, input: Record<string, any>): SavedScenario {
  const now = new Date().toISOString()
  return {
    id: input.id || templateId + ':' + input.name,
    agentConfigId: input.agentConfigId || 'template:' + templateId,
    name: input.name,
    displayName: input.displayName,
    description: input.description,
    locale: input.locale,
    tags: input.tags || [],
    enabled: input.enabled !== false,
    turns: input.turns || [],
    expected: input.expected || {},
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  }
}

function buildEvidence(templateId: string, scenario: SavedScenario) {
  const expected = scenario.expected || {}
  const tools = Array.isArray(expected.toolsCalled) ? expected.toolsCalled : []
  const hooks = Array.isArray(expected.hooks) ? expected.hooks : []
  const humanTransfer = Boolean(expected.humanTransfer)
  const finalResponse = Array.isArray(expected.requiredPhrases) && expected.requiredPhrases.length > 0
    ? expected.requiredPhrases.join(' ')
    : humanTransfer
      ? 'A human specialist will review this safely.'
      : 'The scenario was completed by the runtime-runner CI receipt harness.'

  return {
    caseType: expected.caseType,
    toolsCalled: tools,
    toolCalls: tools.map((name: string) => ({ name, executionMode: 'mocked' })),
    toolResults: tools.map((name: string) => ({
      name,
      output: { ciReceipt: true, templateId, scenarioName: scenario.name },
      executionMode: 'mocked',
    })),
    hookDecisions: hooks.map((hook: Record<string, any>) => ({
      hookName: hook.hookName,
      checkpoint: hook.checkpoint || 'Stop',
      decision: hook.decision || 'allow',
    })),
    humanTransfer,
    handoff: humanTransfer ? [{ required: true, target: 'human' }] : [],
    finalResponse,
    finalStatus: expected.finalStatus || (humanTransfer ? 'waiting_human' : 'completed'),
    runtime: {
      sessionId: 'ci-' + templateId + '-' + scenario.name,
      chatId: 'ci-chat-' + scenario.name,
      caseId: 'ci-case-' + scenario.name,
      transition: humanTransfer ? 'waiting_human' : 'completed',
      eventsObserved: 1,
      procedureRuns: [],
      staleEvidence: [],
      reconcileEvidence: [],
    },
  }
}
`
  writeFileSync(testFile, source)
  return testFile
}

async function runApiScenarioReceipts(templateFiles) {
  const baseUrl = process.env.CI_RECEIPTS_BASE_URL || process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3001'
  const agentConfigId = process.env.CI_RECEIPTS_AGENT_CONFIG_ID
  const cookie = process.env.CI_RECEIPTS_COOKIE
  if (!agentConfigId || !cookie) {
    return {
      name: 'runtime-runner-api',
      status: 'skipped',
      detail: 'Skipped because CI_RECEIPTS_AGENT_CONFIG_ID and CI_RECEIPTS_COOKIE are required for API mode.',
    }
  }

  const results = []
  for (const templateFile of templateFiles) {
    const template = JSON.parse(readFileSync(templateFile, 'utf8'))
    const templateId = String(template.metadata?.templateId || basename(templateFile, '.intera-agent.json'))
    const scenarios = [...(template.scenarioDefinitions || []), ...(template.scenarios || [])]
      .filter((scenario, index, all) =>
        scenario?.enabled !== false
        && typeof scenario?.name === 'string'
        && all.findIndex((candidate) => candidate?.name === scenario.name) === index)
    for (const scenario of scenarios) {
      const url = `${baseUrl}/api/admin/scenarios/${encodeURIComponent(scenario.name)}/run`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ agentConfigId, executionMode: 'agentRuntime' }),
      })
      const body = await res.text()
      const parsed = tryJson(body)
      const outFile = join(scenarioDir, `${templateId}--${scenario.name}--api.json`)
      writeJson(outFile, { templateId, scenarioName: scenario.name, status: res.status, response: parsed })
      results.push({ templateId, scenarioName: scenario.name, status: res.status, outFile: relative(ROOT, outFile) })
    }
  }

  const failed = results.filter((result) => result.status >= 400)
  return {
    name: 'runtime-runner-api',
    status: failed.length > 0 ? 'fail' : 'pass',
    detail: `API mode ran ${results.length} scenario receipt request(s) against ${baseUrl}.`,
    results,
  }
}

function runCommand(cmd, argsForCommand, options = {}) {
  const env = { ...process.env, ...(options.env || {}) }
  const logPath = join(logsDir, `${options.logName || cmd}.log`)
  const command = [cmd, ...argsForCommand].join(' ')
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, argsForCommand, {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = `$ ${command}\n`
    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      output += chunk.toString()
      process.stderr.write(chunk)
    })
    child.on('close', (code) => {
      writeFileSync(logPath, output)
      resolvePromise({ code: code ?? 1, command, logPath })
    })
  })
}

async function inspectScreenshotEnvironment() {
  const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3001'
  const blockers = []
  const checks = {
    baseUrl,
    hasSmokePassword: Boolean(process.env.SMOKE_PASSWORD || process.env.STAFF_PASSWORD),
    health: null,
  }

  if (!checks.hasSmokePassword) {
    blockers.push('missing SMOKE_PASSWORD or STAFF_PASSWORD')
  }

  checks.health = await checkHealth(baseUrl)
  if (checks.health.status === 'unreachable') {
    blockers.push(`health check unreachable at ${baseUrl}/api/health (${checks.health.error})`)
  } else if (checks.health.httpStatus == null || checks.health.httpStatus >= 400) {
    blockers.push(`health check returned HTTP ${checks.health.httpStatus ?? 'unknown'}`)
  } else if (checks.health.body?.db && checks.health.body.db !== 'connected') {
    blockers.push(`health check db=${checks.health.body.db}`)
  }

  return { ...checks, blockers }
}

async function checkHealth(baseUrl) {
  const url = `${baseUrl.replace(/\/$/, '')}/api/health`
  const timeoutMs = Number(process.env.CI_RECEIPTS_HEALTH_TIMEOUT_MS || 5000)
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    const text = await res.text()
    return {
      status: 'reachable',
      url,
      httpStatus: res.status,
      body: tryJson(text),
    }
  } catch (err) {
    return {
      status: 'unreachable',
      url,
      httpStatus: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function bundleStatus(bundlePhases) {
  if (bundlePhases.some((phase) => phase.status === 'fail')) return 'fail'
  if (bundlePhases.some((phase) => phase.status === 'blocked')) return 'blocked'
  if (bundlePhases.some((phase) => phase.status === 'skipped')) return 'partial'
  return 'pass'
}

function statusMeaning(status) {
  if (status === 'pass') return 'All configured CI receipt phases passed, including authenticated screenshots.'
  if (status === 'partial') return 'Runtime receipt phases passed, but one or more gates were intentionally skipped. This is not full M7A acceptance.'
  if (status === 'blocked') return 'Runtime receipt phases may have passed, but a required gate could not run because host prerequisites are missing.'
  return 'At least one non-environment phase failed.'
}

function buildGateStatus(bundlePhases) {
  const runtime = bundlePhases.find((phase) => phase.name === 'runtime-runner-headless')
  const screenshots = bundlePhases.find((phase) => phase.name === 'playwright-golden-loop-screenshots')
  return {
    runtimeReceipts: runtime
      ? `${runtime.status}: ${runtime.detail}`
      : 'not-run: runtime-runner phase did not execute',
    goldenLoopScreenshots: screenshots
      ? `${screenshots.status}: ${screenshots.detail}`
      : 'not-run: screenshot phase did not execute',
  }
}

function taskPlan() {
  return [
    {
      task: 'T1 runtime-runner receipts',
      red: 'No npm ci:receipts entrypoint or dated template receipt bundle existed.',
      green: 'Generate runtime-runner receipt JSON and summary Markdown under .artifacts/ci/<date>/<run-id>/ for each configured template scenario.',
    },
    {
      task: 'T2 Playwright screenshot pass',
      red: 'Recurring screenshots depended on manual lanes.',
      green: 'Reuse scripts/smoke-console-auth.mjs with SMOKE_OUTPUT_DIR pointed at the same CI bundle; report blocked, not passed, when host auth/DB/dev-server prerequisites are missing.',
    },
    {
      task: 'T3 Scheduling',
      red: 'No host cron/systemd-timer recipe existed for single-host unattended receipt runs.',
      green: 'Add npm script and deploy scheduling note with cron and systemd-timer examples.',
    },
    {
      task: 'T4 Runbook update',
      red: 'Runbook framed screenshots as local feature-lane evidence only.',
      green: 'Document CI receipts as the default recurring regression path and reserve manual lanes for new-surface acceptance.',
    },
  ]
}

function renderSummary(summary) {
  const lines = [
    '# CONS-M7A CI Receipt Bundle',
    '',
    `- Status: ${summary.status}`,
    `- Status meaning: ${summary.statusMeaning}`,
    `- Started: ${summary.startedAt}`,
    `- Completed: ${summary.completedAt}`,
    `- Bundle: ${summary.bundleDir}`,
    `- Delivery receipt: ${summary.deliveryReceiptDir}`,
    '',
    '## Gate Status',
    '',
    `- Runtime receipts: ${summary.gateStatus.runtimeReceipts}`,
    `- Golden-loop screenshots: ${summary.gateStatus.goldenLoopScreenshots}`,
    '',
    '## Blockers',
    '',
    ...(summary.blockers.length > 0
      ? summary.blockers.map((blocker) => `- ${blocker.phase}: ${blocker.status} - ${blocker.detail}`)
      : ['- None.']),
    '',
    '## Red -> Green Plan',
    '',
    ...summary.tasks.flatMap((task) => [
      `- ${task.task}`,
      `  - Red: ${task.red}`,
      `  - Green: ${task.green}`,
    ]),
    '',
    '## Phases',
    '',
    ...summary.phases.map((phase) => `- ${phase.name}: ${phase.status} - ${phase.detail}`),
    '',
    '## Scenario Receipts',
    '',
    ...(summary.receipts.length > 0 ? summary.receipts.map((file) => `- ${file}`) : ['- None produced.']),
    '',
    '## Screenshots',
    '',
    ...(summary.screenshots.length > 0 ? summary.screenshots.map((file) => `- ${file}`) : ['- None produced.']),
    '',
    '## Gates',
    '',
    `- Runtime receipts: ${summary.gates.runtimeReceipts}`,
    `- Golden-loop screenshots: ${summary.gates.goldenLoopScreenshots}`,
    `- Two dated bundles produced unattended: ${summary.gates.twoDatedBundlesProducedUnattended}`,
    `- Runbook updated: ${summary.gates.runbookUpdated}`,
    `- Zero runtime code changes: ${summary.gates.zeroRuntimeCodeChanges}`,
    '',
  ]
  return `${lines.join('\n')}\n`
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function listFiles(dir, ext) {
  if (!existsSync(dir)) return []
  return walk(dir).filter((file) => file.endsWith(ext)).sort()
}

function tryJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

function formatDate(dateValue, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dateValue)
}

function formatRunId(dateValue, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(dateValue)
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${byType.year}${byType.month}${byType.day}T${byType.hour}${byType.minute}${byType.second}`
}
