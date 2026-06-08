import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.join(process.cwd(), 'apps/console/app/globals.css'), 'utf8')

function sectionBetween(start: string, end: string) {
  const startIndex = css.indexOf(start)
  const endIndex = css.indexOf(end)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return css.slice(startIndex, endIndex)
}

const tokenSection = sectionBetween(
  'Quiet Agent Studio - design tokens',
  'Intera Console',
)

const primitiveSection = sectionBetween(
  '.intera-app-surface',
  '.glass-card',
)

describe('Quiet Agent Studio design primitives', () => {
  it('defines primitive, semantic, and component token layers', () => {
    expect(tokenSection).toContain('--primitive-canvas-0: #f7f7f3;')
    expect(tokenSection).toContain('--primitive-deep-950: #10171d;')
    expect(tokenSection).toContain('--color-bg-app: var(--primitive-canvas-0);')
    expect(tokenSection).toContain('--color-workspace-bg: var(--primitive-deep-950);')
    expect(tokenSection).toContain('--shell-sidebar-width: 248px;')
    expect(tokenSection).toContain('--command-bar-width: 720px;')
    expect(tokenSection).toContain('--diff-surface-bg: var(--color-workspace-bg);')
  })

  it('exposes reusable foundation classes for upcoming UI lanes', () => {
    for (const className of [
      '.intera-workspace-surface',
      '.intera-workspace-panel',
      '.intera-panel',
      '.intera-status',
      '.intera-command-overlay',
      '.intera-command-panel',
      '.intera-diff-surface',
      '.intera-diff-row',
    ]) {
      expect(primitiveSection).toContain(className)
    }
  })

  it('keeps the new primitive blocks free of decorative background-pattern selectors', () => {
    expect(`${tokenSection}\n${primitiveSection}`).not.toMatch(/\b(orb|blob|bokeh)\b/i)
  })
})
