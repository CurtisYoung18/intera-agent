import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MockLiveChatServer } from '../mocks/livechat-api-mock'

describe('MockLiveChatServer', () => {
  let server: MockLiveChatServer

  beforeEach(() => {
    server = new MockLiveChatServer()
    server.install()
  })

  it('records calls with action and body', async () => {
    await fetch('https://api.livechatinc.com/v3.5/agent/action/send_event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: '123', event: { type: 'message', text: 'hello' } }),
    })

    expect(server.calls).toHaveLength(1)
    expect(server.calls[0]!.action).toBe('send_event')
    expect(server.calls[0]!.body).toHaveProperty('chat_id', '123')
  })

  it('returns 200 by default', async () => {
    const res = await fetch('https://api.livechatinc.com/v3.5/agent/action/send_event', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true })
  })

  it('shouldFail returns error for matching action', async () => {
    server.shouldFail.set('send_event', { status: 401, body: 'unauthorized' })

    const res = await fetch('https://api.livechatinc.com/v3.5/agent/action/send_event', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('unauthorized')
  })

  it('expectCalls asserts count correctly', async () => {
    await fetch('https://api.livechatinc.com/v3.5/agent/action/send_event', { method: 'POST', body: '{}' })
    await fetch('https://api.livechatinc.com/v3.5/agent/action/send_event', { method: 'POST', body: '{}' })

    server.expectCalls('send_event', 2)
  })

  it('expectCalls throws on mismatch', () => {
    expect(() => server.expectCalls('send_event', 5)).toThrow()
  })

  it('expectNoCalls throws if calls exist', async () => {
    await fetch('https://api.livechatinc.com/v3.5/agent/action/send_event', { method: 'POST', body: '{}' })
    expect(() => server.expectNoCalls('send_event')).toThrow()
  })

  it('reset clears calls and failures', async () => {
    server.shouldFail.set('send_event', { status: 500 })
    await fetch('https://api.livechatinc.com/v3.5/agent/action/send_event', { method: 'POST', body: '{}' })

    server.reset()

    expect(server.calls).toHaveLength(0)
    expect(server.shouldFail.size).toBe(0)
  })
})
