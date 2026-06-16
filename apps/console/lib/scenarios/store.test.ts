import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { buildScenarioReceipt } from '@/lib/scenarios/runner'
import {
  appendScenarioReceipt,
  defaultScenarioStorePath,
  listScenarios,
  resolveScenarioStoreBaseDir,
  saveScenario,
} from '@/lib/scenarios/store'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function makeRepoRoot(root: string): void {
  mkdirSync(path.join(root, 'apps/console'), { recursive: true })
  writeFileSync(path.join(root, 'package.json'), '{}\n')
  writeFileSync(path.join(root, 'package-lock.json'), '{}\n')
  writeFileSync(path.join(root, 'apps/console/tsconfig.json'), '{}\n')
}

afterEach(() => {
  delete process.env.INTERA_SCENARIO_STORE_PATH
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

  it('does not mistake a standalone bundle root for the repo root', () => {
    const root = makeTempDir('intera-scenario-store-standalone-false-positive-')
    makeRepoRoot(root)
    const standaloneRoot = path.join(root, 'apps/console/.next/standalone')
    mkdirSync(path.join(standaloneRoot, 'apps/console'), { recursive: true })
    writeFileSync(path.join(standaloneRoot, 'package.json'), '{}\n')
    writeFileSync(path.join(standaloneRoot, 'apps/console/tsconfig.json'), '{}\n')

    expect(resolveScenarioStoreBaseDir(path.join(standaloneRoot, 'apps/console'))).toBe(root)
    expect(defaultScenarioStorePath(path.join(standaloneRoot, 'apps/console'))).toBe(
      path.join(root, '.intera-agent-runtime', 'scenarios.json'),
    )
  })
})

describe('scenario receipt persistence integrity', () => {
  it('refuses to append a receipt when the Scenario catalog was unexpectedly emptied', async () => {
    const root = makeTempDir('intera-scenario-store-integrity-')
    const storePath = path.join(root, 'scenarios.json')
    process.env.INTERA_SCENARIO_STORE_PATH = storePath

    const scenario = await saveScenario('agent-a', {
      name: 'deposit_missing_evidence',
      displayName: 'Deposit missing evidence',
      tags: ['deposit'],
      turns: [{ role: 'user', content: 'My deposit is missing.' }],
      expected: { caseType: 'deposit_issue' },
      enabled: true,
    })
    const receipt = buildScenarioReceipt(scenario, { caseType: 'deposit_issue' }, {
      executionMode: 'agentRuntime',
      toolExecutionMode: 'runtime',
    })

    writeFileSync(storePath, JSON.stringify({
      version: 1,
      agents: {
        'agent-a': {
          validationState: 'Not validated',
          scenarios: {},
          receipts: [],
        },
      },
    }, null, 2))

    await expect(
      appendScenarioReceipt('agent-a', receipt, { scenarioSnapshot: scenario }),
    ).rejects.toThrow(/Scenario catalog is empty/)

    const result = await listScenarios('agent-a')
    expect(result.scenarios).toHaveLength(0)
    expect(result.receipts).toHaveLength(0)

    delete process.env.INTERA_SCENARIO_STORE_PATH
  })
})
