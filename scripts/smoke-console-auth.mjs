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

  const response = await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle' })
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

  const browser = await chromium.launch({ headless: true })

  try {
    const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await desktopContext.addCookies([
      {
        name: sessionCookie.name,
        value: sessionCookie.value,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
        secure: false,
      },
    ])
    const desktopPage = await desktopContext.newPage()
    const desktop = []
    for (const route of desktopRoutes) {
      desktop.push(await smokeRoute(desktopPage, route, 1440, 900))
    }
    await desktopContext.close()

    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    })
    await mobileContext.addCookies([
      {
        name: sessionCookie.name,
        value: sessionCookie.value,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
        secure: false,
      },
    ])
    const mobilePage = await mobileContext.newPage()
    const mobile = []
    for (const route of mobileRoutes) {
      mobile.push(await smokeRoute(mobilePage, route, 390, 844))
    }
    await mobileContext.close()

    const summary = { desktop, mobile }
    const summaryPath = resolve(OUTPUT_DIR, 'summary.json')
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)

    const failures = [...desktop, ...mobile].filter((item) => {
      const hasOverflow = item.overflow.scrollWidth > item.overflow.width || item.overflow.bodyScrollWidth > item.overflow.width
      return item.redirectedToLogin || (item.status != null && item.status >= 400) || hasOverflow || item.consoleErrors.length > 0 || item.pageErrors.length > 0 || item.hasMain < 1
    })

    console.log(JSON.stringify({ ok: failures.length === 0, summaryPath, failures }, null, 2))
    if (failures.length > 0) process.exit(1)
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exit(1)
})
