// apps/chat/lib/livechat/__tests__/mocks/livechat-api-mock.ts
// Mock LiveChat REST API for unit/integration testing.

import { vi } from 'vitest'

export interface MockLiveChatCall {
  action: string
  body: Record<string, unknown>
}

export class MockLiveChatServer {
  calls: MockLiveChatCall[] = []
  shouldFail: Map<string, { status: number; body?: string }> = new Map()

  install(): void {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const urlStr = String(url)
      const action = urlStr.split('/').pop() ?? ''
      const body = init?.body ? JSON.parse(init.body as string) as Record<string, unknown> : null
      this.calls.push({ action, body: body ?? {} })

      const failure = this.shouldFail.get(action)
      if (failure) {
        return new Response(failure.body ?? 'mock error', { status: failure.status })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }))
  }

  reset(): void {
    this.calls = []
    this.shouldFail.clear()
  }

  uninstall(): void {
    vi.unstubAllGlobals()
  }

  expectCalls(action: string, count: number): MockLiveChatCall[] {
    const matching = this.calls.filter(c => c.action === action)
    if (matching.length !== count) {
      throw new Error(`Expected ${count} ${action} calls, got ${matching.length}`)
    }
    return matching
  }

  expectNoCalls(action: string): void {
    this.expectCalls(action, 0)
  }
}
