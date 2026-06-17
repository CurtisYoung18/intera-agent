// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('closeMomentIfPossible', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    window.__interaMomentsSdkPromise = undefined
    window.MomentsSDK = undefined
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    window.__interaMomentsSdkPromise = undefined
    window.MomentsSDK = undefined
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

  it('reuses the injected LiveChat MomentsSDK object when the widget already provides one', async () => {
    const closeSpy = vi.fn(async () => {})
    window.MomentsSDK = { close: closeSpy }

    const { ensureMomentsSdk, closeMomentIfPossible } = await import('@/lib/livechat/moments-sdk')
    const sdk = await ensureMomentsSdk({ title: 'Transaction History Details' })
    const closed = await closeMomentIfPossible({ title: 'Transaction History Details' })

    expect(sdk).toBe(window.MomentsSDK)
    expect(closed).toBe(true)
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('trusts sdk.close() when the official widget runtime is available', async () => {
    history.pushState({}, '', '/third')
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const closeSpy = vi.fn(async () => {})
    window.__interaMomentsSdkPromise = Promise.resolve({ close: closeSpy })

    const { closeMomentIfPossible } = await import('@/lib/livechat/moments-sdk')
    const closed = await closeMomentIfPossible({ title: 'Transaction History Details' })

    expect(closed).toBe(true)
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(backSpy).not.toHaveBeenCalled()
  })
})
