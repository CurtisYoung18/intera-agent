// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ConversationsWorkspace from '@/components/operate/conversations-workspace'
import ConversationDetailWorkspace from '@/components/operate/conversation-detail-workspace'

const h = vi.hoisted(() => ({
  apiClient: vi.fn(),
  routerPush: vi.fn(),
  searchParams: new URLSearchParams(),
}))

vi.mock('@/lib/api/client', () => ({
  apiClient: (...args: unknown[]) => h.apiClient(...args),
}))

vi.mock('@/lib/agent/agent-context', () => ({
  useAgentContext: () => ({
    selectedAgentId: 'agent-a',
    loading: false,
    loadError: null,
  }),
}))

vi.mock('@/components/locale-provider', () => ({
  useConsoleLocale: () => ({
    locale: 'en',
    t: (key: string, values?: Record<string, unknown>) => {
      if (!values) return key
      return Object.entries(values).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), key)
    },
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.routerPush }),
  useSearchParams: () => h.searchParams,
}))

function chatSession(overrides: Record<string, unknown> = {}) {
  return {
    chatId: 'chat-new',
    userId: 'user-new',
    cases: [{
      id: 'run-new',
      runId: 'run-new',
      type: 'deposit_not_credited',
      status: 'active',
      source: 'live',
      goal: 'Newest chat',
      createdAt: '2026-06-16T00:00:00.000Z',
      updatedAt: '2026-06-16T00:03:00.000Z',
      _count: { messages: 3 },
    }],
    messageCount: 3,
    lastActivity: '2026-06-16T00:03:00.000Z',
    hasHumanTask: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.searchParams = new URLSearchParams()
  h.routerPush.mockReset()
  h.apiClient.mockImplementation(async (url: string) => {
    if (url.includes('/api/chats/chat-new/traces')) {
      return { ok: true, data: { traces: [] } }
    }
    if (url.includes('/api/chats/chat-new/messages')) {
      return {
        ok: true,
        data: {
          messages: [{
            id: 'msg-deposit-user',
            role: 'user',
            content: 'My deposit is still missing after UTR JAYA117FFEB.',
            createdAt: '2026-06-16T00:03:20.000Z',
            runId: 'run-new',
            procedureType: 'deposit_not_credited',
            procedureStatus: 'active',
          }],
        },
      }
    }
    if (url.includes('/api/chats/chat-new')) {
      return {
        ok: true,
        data: {
          session: chatSession(),
          requestedChatId: 'chat-new',
          resolvedChatId: 'chat-new',
        },
      }
    }
    if (url.includes('q=deposit')) {
      return {
        ok: true,
        data: {
          sessions: [chatSession({
            matchedMessages: [{
              messageId: 'msg-deposit-user',
              caseId: 'case-new',
              runId: 'run-new',
              role: 'user',
              createdAt: '2026-06-16T00:03:20.000Z',
              snippet: 'My deposit is still missing after UTR JAYA117FFEB.',
              rank: 0.72,
            }],
          })],
          total: 1,
          query: { normalizedQuery: 'deposit', searchMode: 'fts' },
        },
      }
    }
    if (url.includes('/api/chats?')) {
      return {
        ok: true,
        data: {
          sessions: [],
          total: 0,
          query: { normalizedQuery: null, searchMode: 'none' },
        },
      }
    }
    throw new Error(`Unexpected apiClient call: ${url}`)
  })
})

describe('conversation content search UI', () => {
  it('debounces server search, renders snippets, and links to the matched message', async () => {
    render(<ConversationsWorkspace />)

    await waitFor(() => {
      expect(h.apiClient).toHaveBeenCalledWith('/api/chats?limit=200&agentId=agent-a')
    })

    fireEvent.change(screen.getByPlaceholderText('Search user, chat, Procedure, or message content'), {
      target: { value: 'deposit' },
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 350))
    })

    await waitFor(() => {
      expect(h.apiClient.mock.calls.some(([url]) => String(url).includes('q=deposit'))).toBe(true)
    })
    expect(screen.getByText('1 message match')).toBeTruthy()
    expect(screen.getByText('deposit')).toBeTruthy()

    const matchedLink = document.querySelector('a[href*="match=msg-deposit-user"]')
    expect(matchedLink?.getAttribute('href')).toContain('q=deposit')
  })

  it('highlights and scrolls the matched message on the detail page', async () => {
    h.searchParams = new URLSearchParams('match=msg-deposit-user&q=deposit')
    const scrollIntoView = vi.fn()
    const originalScroll = Element.prototype.scrollIntoView
    const originalRaf = window.requestAnimationFrame
    Element.prototype.scrollIntoView = scrollIntoView
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0)
      return 1
    }) as typeof window.requestAnimationFrame

    try {
      render(<ConversationDetailWorkspace chatId="chat-new" />)

      await waitFor(() => {
        expect(document.querySelector('[data-message-id="msg-deposit-user"]')).toBeTruthy()
      })
      const matchedRow = document.querySelector('[data-message-id="msg-deposit-user"]')
      expect(matchedRow?.className).toContain('ring-1')
      expect(document.querySelector('mark')?.textContent).toBe('deposit')
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
    } finally {
      Element.prototype.scrollIntoView = originalScroll
      window.requestAnimationFrame = originalRaf
    }
  })
})
