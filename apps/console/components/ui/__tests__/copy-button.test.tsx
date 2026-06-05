// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import React from 'react'
import CopyButton from '../copy-button'

describe('CopyButton', () => {
  const clipboardWriteText = vi.fn(() => Promise.resolve())

  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipboardWriteText },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    clipboardWriteText.mockClear()
  })

  it('renders a button', () => {
    render(<CopyButton text="hello" />)
    const button = screen.getByRole('button')
    expect(button).toBeDefined()
  })

  it('calls navigator.clipboard.writeText with the exact text on click', () => {
    render(<CopyButton text="hello world" />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(clipboardWriteText).toHaveBeenCalledWith('hello world')
  })

  it('shows Copied state after click and reverts after 1.5s', async () => {
    vi.useFakeTimers()
    render(<CopyButton text="test" />)

    const button = screen.getByRole('button')

    // Wrap click + microtask flush in act so the promise .then() runs
    await act(async () => {
      fireEvent.click(button)
    })

    // Should show Copied state
    expect(screen.getByText(/Copied/)).toBeDefined()

    // After 1.5s, should revert to copy icon
    act(() => {
      vi.advanceTimersByTime(1500)
    })

    expect(screen.queryByText(/Copied/)).toBeNull()
    vi.useRealTimers()
  })

  it('uses custom label as aria-label when provided', () => {
    render(<CopyButton text="test" label="Copy code" />)
    const button = screen.getByRole('button', { name: 'Copy code' })
    expect(button).toBeDefined()
  })

  it('uses default aria-label "Copy" when no label provided', () => {
    render(<CopyButton text="test" />)
    const button = screen.getByRole('button', { name: 'Copy' })
    expect(button).toBeDefined()
  })
})
