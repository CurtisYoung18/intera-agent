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

  it('does not navigate the browser when no Moments SDK close handler is available', async () => {
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {})
    window.__interaMomentsSdkPromise = Promise.resolve(null)

    const { closeMomentIfPossible } = await import('@/lib/livechat/moments-sdk')
    const closed = await closeMomentIfPossible({ title: 'Transaction History Details' })

    expect(closed).toBe(true)
    expect(backSpy).not.toHaveBeenCalled()
    expect(closeSpy).not.toHaveBeenCalled()
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
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const closeWindowSpy = vi.spyOn(window, 'close').mockImplementation(() => {})
    const closeSpy = vi.fn(async () => {})
    window.__interaMomentsSdkPromise = Promise.resolve({ close: closeSpy })

    const { closeMomentIfPossible } = await import('@/lib/livechat/moments-sdk')
    const closed = await closeMomentIfPossible({ title: 'Transaction History Details' })

    expect(closed).toBe(true)
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(backSpy).not.toHaveBeenCalled()
    expect(closeWindowSpy).not.toHaveBeenCalled()
  })

  it('does not force browser navigation when sdk.close() rejects', async () => {
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const closeWindowSpy = vi.spyOn(window, 'close').mockImplementation(() => {})
    const closeSpy = vi.fn(async () => {
      throw new Error('timeout')
    })
    window.__interaMomentsSdkPromise = Promise.resolve({ close: closeSpy })

    const { closeMomentIfPossible } = await import('@/lib/livechat/moments-sdk')
    const closed = await closeMomentIfPossible({ title: 'Transaction History Details' })

    expect(closed).toBe(true)
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(backSpy).not.toHaveBeenCalled()
    expect(closeWindowSpy).not.toHaveBeenCalled()
  })
})
