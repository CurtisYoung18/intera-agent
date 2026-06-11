import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { defaultScenarioStorePath, resolveScenarioStoreBaseDir } from '@/lib/scenarios/store'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function makeRepoRoot(root: string): void {
  mkdirSync(path.join(root, 'apps/console'), { recursive: true })
  writeFileSync(path.join(root, 'package.json'), '{}\n')
  writeFileSync(path.join(root, 'apps/console/tsconfig.json'), '{}\n')
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('scenario store path resolution', () => {
  it('keeps standalone production writes anchored at the repo root', () => {
    const root = makeTempDir('intera-scenario-store-root-')
    makeRepoRoot(root)
    const standaloneDir = path.join(root, 'apps/console/.next/standalone/apps/console')
    mkdirSync(standaloneDir, { recursive: true })

    expect(resolveScenarioStoreBaseDir(standaloneDir)).toBe(root)
    expect(defaultScenarioStorePath(standaloneDir)).toBe(path.join(root, '.intera-agent-runtime', 'scenarios.json'))
  })

  it('walks up to the repo root when started inside apps/console', () => {
    const root = makeTempDir('intera-scenario-store-app-')
    makeRepoRoot(root)
    const appDir = path.join(root, 'apps/console')

    expect(resolveScenarioStoreBaseDir(appDir)).toBe(root)
    expect(defaultScenarioStorePath(appDir)).toBe(path.join(root, '.intera-agent-runtime', 'scenarios.json'))
  })

  it('falls back to the current directory when no repo markers exist', () => {
    const dir = makeTempDir('intera-scenario-store-fallback-')

    expect(resolveScenarioStoreBaseDir(dir)).toBe(dir)
    expect(defaultScenarioStorePath(dir)).toBe(path.join(dir, '.intera-agent-runtime', 'scenarios.json'))
  })
})
