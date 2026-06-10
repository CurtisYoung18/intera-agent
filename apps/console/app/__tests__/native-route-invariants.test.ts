import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.join(process.cwd(), 'apps/console/app')
const TARGET_ROOTS = ['build', 'operate', 'settings'].map((segment) => path.join(ROOT, segment))
const COMPONENT_ROOT = path.join(process.cwd(), 'apps/console/components')
const TARGET_COMPONENT_ROOTS = ['brain', 'operate', 'settings', 'integrations', 'release', 'config-diff', 'scenario-receipts'].map((segment) =>
  path.join(COMPONENT_ROOT, segment),
)
const DICTIONARIES_PATH = path.join(process.cwd(), 'apps/console/lib/i18n/dictionaries.ts')
const ALLOWED_COMPATIBILITY_IMPORTS = new Map<string, string[]>([
  [
    path.join(ROOT, 'build', 'pilot-lab', 'page.tsx'),
    ["import PlaygroundPage from '@/app/admin/playground/page'"],
  ],
])
const ALLOWED_TERMINOLOGY_LITERALS: Array<{ pattern: RegExp; note: string }> = [
  { pattern: /showSkillStatus/g, note: 'internal LiveChat config field name' },
  { pattern: /skillOverrides/g, note: 'internal i18n key stem' },
  { pattern: /skillsCol/g, note: 'internal i18n key stem' },
  { pattern: /lastCaseType/g, note: 'internal profile field name' },
  { pattern: /CaseTypeItem/g, note: 'contract type name until backend rename lands' },
  { pattern: /CaseTypeOption/g, note: 'contract type name until backend rename lands' },
  { pattern: /platform policy/gi, note: 'compatibility rewrite source literal' },
]
const RELEVANT_DICTIONARY_PREFIXES = [
  'sidebar.',
  'caseTypes.',
  'caseDetail.',
  'livechat.',
  'organization.',
  'integrationsPage.',
]

function walkPages(dir: string): string[] {
  const entries = readdirSync(dir)
  const results: string[] = []
  for (const entry of entries) {
    const nextPath = path.join(dir, entry)
    const stats = statSync(nextPath)
    if (stats.isDirectory()) {
      results.push(...walkPages(nextPath))
      continue
    }
    if (entry === 'page.tsx') results.push(nextPath)
  }
  return results
}

function walkSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir)
  const results: string[] = []
  for (const entry of entries) {
    const nextPath = path.join(dir, entry)
    const stats = statSync(nextPath)
    if (stats.isDirectory()) {
      results.push(...walkSourceFiles(nextPath))
      continue
    }
    if (entry.endsWith('.ts') || entry.endsWith('.tsx')) results.push(nextPath)
  }
  return results
}

function disallowedRouteImports(src: string) {
  return src
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.includes("from '@/app/admin/") ||
        line.includes("from '@/app/ops/") ||
        line.includes("export { default } from '@/app/admin/") ||
        line.includes("export { default } from '@/app/ops/"),
    )
}

function disallowedLegacyRouteNavigations(src: string) {
  const patterns = [
    /href\s*=\s*["'`]\/admin/g,
    /href\s*=\s*["'`]\/ops/g,
    /router\.(push|replace)\(\s*["'`]\/admin/g,
    /router\.(push|replace)\(\s*["'`]\/ops/g,
    /window\.location\.(assign|replace)\(\s*["'`]\/admin/g,
    /window\.location\.(assign|replace)\(\s*["'`]\/ops/g,
    /window\.location\.href\s*=\s*["'`]\/admin/g,
    /window\.location\.href\s*=\s*["'`]\/ops/g,
  ]

  return patterns.flatMap((pattern) => src.match(pattern) ?? [])
}

function stripAllowedTerminologyMatches(src: string) {
  return ALLOWED_TERMINOLOGY_LITERALS.reduce((current, entry) => current.replace(entry.pattern, ''), src)
}

function disallowedLegacyTerminology(src: string) {
  const sanitized = stripAllowedTerminologyMatches(src)
  const patterns = [
    /\bCase Type\b/gi,
    /\bCase Types\b/gi,
    /\bGuardrail\b/gi,
    /\bGuardrails\b/gi,
    /\bPolicy\b/gi,
    /\bPolicies\b/gi,
    /\bSkill\b/gi,
    /\bSkills\b/gi,
    /\bSub-Agent\b/gi,
    /\bSub-Agents\b/gi,
    /案例类型/g,
    /护栏/g,
    /子代理/g,
  ]

  return patterns.flatMap((pattern) => sanitized.match(pattern) ?? [])
}

function relevantDictionaryValues(src: string) {
  return src
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => RELEVANT_DICTIONARY_PREFIXES.some((prefix) => line.startsWith(`'${prefix}`)))
    .map((line) => {
      const match = line.match(/:\s*'([^']*)'/)
      return match?.[1] ?? ''
    })
}

describe('native route invariants', () => {
  const targetPages = TARGET_ROOTS.flatMap((dir) => walkPages(dir)).sort()
  const targetSources = [...targetPages, ...TARGET_COMPONENT_ROOTS.flatMap((dir) => walkSourceFiles(dir)).sort()]
  const terminologySources = targetSources

  it('keeps Build / Operate / Settings pages free of old admin/ops page imports except the approved Playground compatibility surface', () => {
    const violations: string[] = []

    for (const filePath of targetPages) {
      const src = readFileSync(filePath, 'utf8')
      const relativePath = path.relative(ROOT, filePath)
      const matches = disallowedRouteImports(src)
      const allowedLines = ALLOWED_COMPATIBILITY_IMPORTS.get(filePath) ?? []
      const unexpectedMatches = matches.filter((line) => !allowedLines.includes(line))

      if (unexpectedMatches.length > 0) {
        violations.push(`${relativePath}: ${unexpectedMatches.join(' | ')}`)
      }
    }

    expect(violations).toEqual([])
  })

  it('keeps primary Build / Operate / Settings routes and shared workspaces free of direct navigation back into old /admin or /ops page paths', () => {
    const violations: string[] = []

    for (const filePath of targetSources) {
      const src = readFileSync(filePath, 'utf8')
      const relativePath = path.relative(process.cwd(), filePath)
      const matches = disallowedLegacyRouteNavigations(src)

      if (matches.length > 0) {
        violations.push(`${relativePath}: ${matches.join(' | ')}`)
      }
    }

    expect(violations).toEqual([])
  })

  it('pins the only approved compatibility reuse to Pilot Lab -> old admin Playground', () => {
    const pilotLabPage = path.join(ROOT, 'build', 'pilot-lab', 'page.tsx')
    const src = readFileSync(pilotLabPage, 'utf8')
    expect(src).toContain("import PlaygroundPage from '@/app/admin/playground/page'")
  })

  it('keeps primary route surfaces and visible dictionaries free of stale legacy product terminology', () => {
    const violations: string[] = []

    for (const filePath of terminologySources) {
      const src = readFileSync(filePath, 'utf8')
      const relativePath = path.relative(process.cwd(), filePath)
      const matches = disallowedLegacyTerminology(src)

      if (matches.length > 0) {
        violations.push(`${relativePath}: ${matches.join(' | ')}`)
      }
    }

    const dictionarySource = readFileSync(DICTIONARIES_PATH, 'utf8')
    const dictionaryMatches = disallowedLegacyTerminology(relevantDictionaryValues(dictionarySource).join('\n'))
    if (dictionaryMatches.length > 0) {
      violations.push(`apps/console/lib/i18n/dictionaries.ts: ${dictionaryMatches.join(' | ')}`)
    }

    expect(violations).toEqual([])
  })
})
