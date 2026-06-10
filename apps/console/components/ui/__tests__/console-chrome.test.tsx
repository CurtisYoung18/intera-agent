// @vitest-environment jsdom
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  ConsolePageHeader,
  ConsoleStatusPill,
  ConsoleSurface,
  ConsoleToolbarButton,
  ConsoleToolbarSurface,
} from '../console-chrome'
import { Settings } from 'lucide-react'

describe('console chrome primitives', () => {
  it('renders shared surface state attributes for material variants', () => {
    render(
      <ConsoleSurface tone="toolbar" padding="sm" interactive className="custom-surface">
        Surface body
      </ConsoleSurface>,
    )

    const surface = screen.getByText('Surface body')
    expect(surface.getAttribute('data-tone')).toBe('toolbar')
    expect(surface.getAttribute('data-padding')).toBe('sm')
    expect(surface.getAttribute('data-interactive')).toBe('true')
    expect(surface.className).toContain('console-surface')
    expect(surface.className).toContain('custom-surface')
  })

  it('renders page header copy, status, and action slots in the shared chrome wrapper', () => {
    render(
      <ConsolePageHeader
        eyebrow="Build"
        title="Pilot Lab"
        description="Shared page chrome keeps headers and toolbar actions in the same material family."
        status={<ConsoleStatusPill tone="progress">Fresh</ConsoleStatusPill>}
        actions={<button type="button">Publish</button>}
      />,
    )

    const header = screen.getByText('Pilot Lab').closest('header')
    expect(header?.className).toContain('console-page-header')
    expect(screen.getByText('Build')).toBeDefined()
    expect(screen.getByText('Fresh').getAttribute('data-tone')).toBe('progress')
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDefined()
  })

  it('keeps toolbar surfaces and toolbar buttons on the shared material API', () => {
    render(
      <ConsoleToolbarSurface>
        <ConsoleToolbarButton icon={Settings} onClick={() => {}} tone="accent">
          Settings
        </ConsoleToolbarButton>
      </ConsoleToolbarSurface>,
    )

    const toolbar = screen.getByRole('button', { name: 'Settings' }).parentElement
    expect(toolbar?.className).toContain('console-toolbar-surface')
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('data-tone')).toBe('accent')
  })
})
