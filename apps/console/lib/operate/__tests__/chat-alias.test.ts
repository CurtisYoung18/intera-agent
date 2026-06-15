import { describe, expect, it, vi } from 'vitest'
import { resolveChatAlias } from '@/lib/operate/chat-alias'

function makeRepo(overrides?: Partial<any>) {
  return {
    orgId: 'default',
    raw: {
      case: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => null),
      },
    },
    externalConversation: {
      findFirst: vi.fn(async () => null),
    },
    ...overrides,
  }
}

describe('resolveChatAlias', () => {
  it('keeps internal chat ids as-is', async () => {
    const repo = makeRepo({
      raw: {
        case: {
          findMany: vi.fn(async () => [{ id: 'case-1' }]),
          findFirst: vi.fn(async () => null),
        },
      },
    })

    await expect(resolveChatAlias(repo as any, 'internal-chat')).resolves.toEqual({
      requestedChatId: 'internal-chat',
      resolvedChatId: 'internal-chat',
      matchedBy: 'internal',
    })
  })

  it('maps livechat external ids back to the canonical internal chat id', async () => {
    const repo = makeRepo({
      raw: {
        case: {
          findMany: vi.fn(async () => []),
          findFirst: vi.fn(async () => ({ chatId: 'internal-chat' })),
        },
      },
      externalConversation: {
        findFirst: vi.fn(async () => ({
          externalChatId: 'T57A5MM8H0',
          internalCaseId: 'case-123',
        })),
      },
    })

    await expect(resolveChatAlias(repo as any, 'T57A5MM8H0')).resolves.toEqual({
      requestedChatId: 'T57A5MM8H0',
      resolvedChatId: 'internal-chat',
      externalChatId: 'T57A5MM8H0',
      matchedBy: 'external',
    })
  })

  it('falls back to the requested id when no alias exists', async () => {
    const repo = makeRepo()
    await expect(resolveChatAlias(repo as any, 'unknown-chat')).resolves.toEqual({
      requestedChatId: 'unknown-chat',
      resolvedChatId: 'unknown-chat',
      matchedBy: 'none',
    })
  })
})
