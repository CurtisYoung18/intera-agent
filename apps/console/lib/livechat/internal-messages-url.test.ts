import { describe, expect, it } from 'vitest'

import { getInternalMessagesUrl, resolveInternalMessagesBaseUrl } from './internal-messages-url'

describe('internal LiveChat messages URL', () => {
  it('uses INTERNAL_CHAT_API_URL when explicitly configured', () => {
    const env = {
      INTERNAL_CHAT_API_URL: 'http://localhost:3999',
      PORT: '3000',
      NODE_ENV: 'production',
    } as NodeJS.ProcessEnv

    expect(resolveInternalMessagesBaseUrl(env)).toBe('http://localhost:3999')
    expect(getInternalMessagesUrl(env)).toBe('http://localhost:3999/api/messages')
  })

  it('falls back to the current process PORT when INTERNAL_CHAT_API_URL is absent', () => {
    const env = {
      PORT: '3105',
      NODE_ENV: 'production',
    } as NodeJS.ProcessEnv

    expect(resolveInternalMessagesBaseUrl(env)).toBe('http://127.0.0.1:3105')
    expect(getInternalMessagesUrl(env)).toBe('http://127.0.0.1:3105/api/messages')
  })

  it('keeps local dev default on 3001 when neither INTERNAL_CHAT_API_URL nor PORT is set', () => {
    const env = {
      NODE_ENV: 'development',
    } as NodeJS.ProcessEnv

    expect(resolveInternalMessagesBaseUrl(env)).toBe('http://127.0.0.1:3001')
  })

  it('uses production-safe port 3000 when no env override exists', () => {
    const env = {
      NODE_ENV: 'production',
    } as NodeJS.ProcessEnv

    expect(resolveInternalMessagesBaseUrl(env)).toBe('http://127.0.0.1:3000')
  })
})
