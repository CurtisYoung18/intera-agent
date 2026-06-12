#!/usr/bin/env node

import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import dotenv from 'dotenv'
import { chromium } from 'playwright'

const ROOT = process.cwd()
const rootEnvPath = resolve(ROOT, '.env.local')
if (existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath })
}

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3001'
const OUTPUT_DIR = resolve(ROOT, process.env.SMOKE_OUTPUT_DIR || '.artifacts/final-smoke')
const LOGIN_EMAIL = process.env.SMOKE_EMAIL || process.env.SEED_OWNER_EMAIL || 'admin@intera.local'
const LOGIN_PASSWORD = process.env.SMOKE_PASSWORD || process.env.STAFF_PASSWORD
const BASE_HOSTNAME = new URL(BASE_URL).hostname

if (!LOGIN_PASSWORD) {
  console.error('Missing STAFF_PASSWORD or SMOKE_PASSWORD in environment')
  process.exit(1)
}

mkdirSync(OUTPUT_DIR, { recursive: true })

function fileSlug(route) {
  return route.replace(/^\//, '').replace(/[/?=&]+/g, '_') || 'root'
}

function parseCookieHeader(setCookieHeader) {
  if (!setCookieHeader) return null
  const first = setCookieHeader.split(';')[0]
  const eq = first.indexOf('=')
  if (eq === -1) return null
  return { name: first.slice(0, eq), value: first.slice(eq + 1) }
}

async function fetchJson(url, init = {}) {
  const res = await fetch(url, init)
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  return { res, json }
}

async function loginAndGetCookie() {
  const { res: healthRes, json: healthJson } = await fetchJson(`${BASE_URL}/api/health`)
  if (!healthRes.ok || healthJson?.db !== 'connected') {
    throw new Error(`Health check failed: status=${healthRes.status} body=${JSON.stringify(healthJson)}`)
  }

  const { res, json } = await fetchJson(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD }),
  })
  if (!res.ok) {
    throw new Error(`Login failed: status=${res.status} body=${JSON.stringify(json)}`)
  }
  const setCookieHeader = res.headers.get('set-cookie')
  const parsed = parseCookieHeader(setCookieHeader)
  if (!parsed?.name || !parsed?.value) {
    throw new Error(`Login succeeded but no session cookie found: ${setCookieHeader ?? 'null'}`)
  }
  return parsed
}

function buildCookieHeader(cookie) {
  return `${cookie.name}=${cookie.value}`
}

function buildContextCookies(cookie) {
  const hostnames = new Set([BASE_HOSTNAME])
  if (BASE_HOSTNAME === '127.0.0.1') hostnames.add('localhost')
  if (BASE_HOSTNAME === 'localhost') hostnames.add('127.0.0.1')

  return [...hostnames].map((domain) => ({
    name: cookie.name,
    value: cookie.value,
    domain,
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: false,
  }))
}

function waitUntilForRoute(route) {
  return 'domcontentloaded'
}

async function waitForRouteReady(page, route) {
  if (route === '/build/pilot-lab') {
    await page.getByRole('heading', { name: 'Pilot state' }).waitFor({ timeout: 15000 })
    return
  }
  if (route === '/build/pilot-lab?tab=playground') {
    await page.getByRole('heading', { name: 'Runtime test desk' }).waitFor({ timeout: 15000 })
    return
  }
  if (route.startsWith('/operate/conversations/cases/')) {
    await page.getByRole('heading', { name: /Timeline & evidence/ }).waitFor({ timeout: 15000 })
    return
  }
  if (route.startsWith('/operate/handoff/') && route !== '/operate/handoff') {
    await page.getByRole('heading', { name: /User profile/ }).waitFor({ timeout: 15000 })
    return
  }
  await page.locator('main').waitFor({ state: 'attached', timeout: 15000 }).catch(() => undefined)
}

async function discoverDetailRoutes(cookie) {
  const headers = { cookie: buildCookieHeader(cookie) }
  const detailRoutes = []

  const chatsResult = await fetchJson(`${BASE_URL}/api/chats?limit=20`, { headers })
  const firstChatId = chatsResult.json?.data?.sessions?.[0]?.chatId
  if (firstChatId) {
    detailRoutes.push(`/operate/conversations/${encodeURIComponent(firstChatId)}`)
  }

  const handoffResult = await fetchJson(`${BASE_URL}/api/cases?status=waiting_human&limit=20`, { headers })
  const firstCase = handoffResult.json?.data?.cases?.[0]
  if (firstCase?.id) {
    detailRoutes.push(`/operate/conversations/cases/${encodeURIComponent(firstCase.id)}`)
    const caseDetailResult = await fetchJson(`${BASE_URL}/api/cases/${encodeURIComponent(firstCase.id)}`, { headers })
    const userId = caseDetailResult.json?.data?.case?.userId
    if (userId) {
      detailRoutes.push(`/operate/handoff/${encodeURIComponent(userId)}`)
    }
  }

  return detailRoutes
}

async function smokeRoute(page, route, width, height) {
  const consoleErrors = []
  const pageErrors = []
  page.removeAllListeners('console')
  page.removeAllListeners('pageerror')
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    pageErrors.push(String(err))
  })

  const response = await page.goto(`${BASE_URL}${route}`, { timeout: 60000, waitUntil: waitUntilForRoute(route) })
  await waitForRouteReady(page, route)
  const status = response?.status() ?? null
  const finalUrl = page.url()
  const redirectedToLogin = finalUrl.includes('/login')
  const hasMain = await page.locator('main').count()
  const overflow = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }))
  const screenshot = resolve(OUTPUT_DIR, `${width === 390 ? 'mobile-390' : 'desktop-1440'}-${fileSlug(route)}.png`)
  await page.screenshot({ path: screenshot, fullPage: true })

  return {
    route,
    status,
    finalUrl,
    redirectedToLogin,
    hasMain,
    overflow,
    consoleErrors,
    pageErrors,
    screenshot,
  }
}

async function smokeLegacyRedirect(page, route, expectedPathname) {
  const consoleErrors = []
  const pageErrors = []
  page.removeAllListeners('console')
  page.removeAllListeners('pageerror')
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    pageErrors.push(String(err))
  })

  const response = await page.goto(`${BASE_URL}${route}`, { timeout: 60000, waitUntil: 'domcontentloaded' })
  const status = response?.status() ?? null
  const finalUrl = page.url()
  const finalPathname = new URL(finalUrl).pathname

  return {
    route,
    status,
    finalUrl,
    expectedPathname,
    finalPathname,
    redirectedCorrectly: finalPathname === expectedPathname,
    consoleErrors,
    pageErrors,
  }
}

async function smokeRoutesInContext(context, routes, width, height) {
  const results = []
  for (const route of routes) {
    const page = await context.newPage()
    try {
      results.push(await smokeRoute(page, route, width, height))
    } finally {
      await page.close()
    }
  }
  return results
}

async function smokeLegacyRedirectsInContext(context, routes) {
  const results = []
  for (const [route, expectedPathname] of routes) {
    const page = await context.newPage()
    try {
      results.push(await smokeLegacyRedirect(page, route, expectedPathname))
    } finally {
      await page.close()
    }
  }
  return results
}

async function main() {
  const sessionCookie = await loginAndGetCookie()
  const detailRoutes = await discoverDetailRoutes(sessionCookie)

  const desktopRoutes = [
    '/build/pilot-lab',
    '/build/pilot-lab?tab=playground',
    '/build/release',
    '/build/components',
    '/build/components/brain',
    '/build/components/procedures',
    '/build/components/hooks',
    '/build/components/tools',
    '/build/components/knowledge',
    '/build/components/integrations',
    '/operate/conversations',
    '/operate/handoff',
    '/settings/organization',
    '/build/components/procedures/deposit_issue',
    ...detailRoutes,
  ]

  const mobileRoutes = [
    '/build/pilot-lab',
    '/build/release',
    '/operate/conversations',
    '/settings/organization',
  ]
  const legacyRedirectRoutes = [
    ['/admin/case-types', '/build/components/procedures'],
    ['/admin/case-types/deposit_issue', '/build/components/procedures/deposit_issue'],
    ['/admin/tools', '/build/components/tools'],
    ['/admin/knowledge', '/build/components/knowledge'],
    ['/admin/integrations', '/build/components/integrations'],
    ['/admin/channels/livechat', '/build/components/integrations'],
    ['/admin/channels/web-chat', '/build/components/integrations'],
    ['/admin/model', '/build/components/brain'],
    ['/admin/organization', '/settings/organization'],
    ['/admin/hooks', '/build/components/hooks'],
    ['/ops/chats', '/operate/conversations'],
    ['/ops/chats/seed-chat-1', '/operate/conversations/seed-chat-1'],
    ['/ops/cases/seed-case-1', '/operate/conversations/cases/seed-case-1'],
    ['/ops/users', '/operate/handoff'],
  ]

  const browser = await chromium.launch({ headless: true })
  const contextCookies = buildContextCookies(sessionCookie)

  try {
    const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await desktopContext.addCookies(contextCookies)
    const desktop = await smokeRoutesInContext(desktopContext, desktopRoutes, 1440, 900)
    await desktopContext.close()

    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    })
    await mobileContext.addCookies(contextCookies)
    const mobile = await smokeRoutesInContext(mobileContext, mobileRoutes, 390, 844)
    await mobileContext.close()

    const redirectContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await redirectContext.addCookies(contextCookies)
    const legacyRedirects = await smokeLegacyRedirectsInContext(redirectContext, legacyRedirectRoutes)
    await redirectContext.close()

    const summary = { desktop, mobile, legacyRedirects }
    const summaryPath = resolve(OUTPUT_DIR, 'summary.json')
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)

    const failures = [...desktop, ...mobile].filter((item) => {
      const hasOverflow = item.overflow.scrollWidth > item.overflow.width || item.overflow.bodyScrollWidth > item.overflow.width
      return item.redirectedToLogin || (item.status != null && item.status >= 400) || hasOverflow || item.consoleErrors.length > 0 || item.pageErrors.length > 0 || item.hasMain < 1
    })
    const redirectFailures = legacyRedirects.filter((item) => !item.redirectedCorrectly || (item.status != null && item.status >= 400) || item.consoleErrors.length > 0 || item.pageErrors.length > 0)

    console.log(JSON.stringify({ ok: failures.length === 0 && redirectFailures.length === 0, summaryPath, failures, redirectFailures }, null, 2))
    if (failures.length > 0 || redirectFailures.length > 0) process.exit(1)
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exit(1)
})
