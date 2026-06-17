// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('closeMomentIfPossible', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    window.__interaMomentsSdkPromise = undefined
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    window.__interaMomentsSdkPromise = undefined
  })

  it('falls back to browser history when no Moments SDK close handler is available', async () => {
    history.pushState({}, '', '/second')
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    window.__interaMomentsSdkPromise = Promise.resolve(null)

    const { closeMomentIfPossible } = await import('@/lib/livechat/moments-sdk')
    const closed = await closeMomentIfPossible({ title: 'Transaction History Details' })

    expect(closed).toBe(true)
    expect(backSpy).toHaveBeenCalledTimes(1)
  })

  it('schedules a browser-history fallback after sdk.close() so submitted cards do not get stranded', async () => {
    history.pushState({}, '', '/third')
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const closeSpy = vi.fn(async () => {})
    window.__interaMomentsSdkPromise = Promise.resolve({ close: closeSpy })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })

    const { closeMomentIfPossible } = await import('@/lib/livechat/moments-sdk')
    const closed = await closeMomentIfPossible({ title: 'Transaction History Details' })

    expect(closed).toBe(true)
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(backSpy).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(350)

    expect(backSpy).toHaveBeenCalledTimes(1)
  })
})
