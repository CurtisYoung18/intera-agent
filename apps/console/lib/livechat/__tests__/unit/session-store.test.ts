import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFindUnique = vi.fn()
const mockUpsert = vi.fn()
const mockUpdate = vi.fn()
const mockTx = vi.fn()
const txFindUnique = vi.fn()
const txUpdate = vi.fn()

const rowStore = new Map<string, {
  externalChatId: string
  orgId: string
  internalCaseId: string
  bridgeState: string
  textBuffer: string
  metadata: { userId: string }
}>()

vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    externalConversation: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    $executeRaw: vi.fn(),
    $transaction: (...args: unknown[]) => mockTx(...args),
    $queryRaw: vi.fn(),
  },
}))

import { getSession, upsertSession, updateSessionState, closeSession, appendTextBuffer, flushTextBuffer } from '../../session-store'
import { encodeLivechatTextBuffer } from '../../text-buffer-codec'

describe('session-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rowStore.clear()
    mockTx.mockImplementation(async (callback: (tx: {
      externalConversation: {
        findUnique: typeof txFindUnique
        update: typeof txUpdate
      }
    }) => unknown) => callback({
      externalConversation: {
        findUnique: txFindUnique,
        update: txUpdate,
      },
    }))
    txFindUnique.mockImplementation(async ({ where }: { where: { platform_externalChatId: { externalChatId: string } } }) => {
      const key = where.platform_externalChatId.externalChatId
      const row = rowStore.get(key)
      return row ? { textBuffer: row.textBuffer } : null
    })
    txUpdate.mockImplementation(async ({ where, data }: { where: { platform_externalChatId: { externalChatId: string } }, data: { textBuffer: string } }) => {
      const key = where.platform_externalChatId.externalChatId
      const row = rowStore.get(key)
      if (!row) throw new Error(`Missing row for ${key}`)
      const next = { ...row, textBuffer: data.textBuffer }
      rowStore.set(key, next)
      return next
    })
  })

  describe('getSession', () => {
    it('returns null when session not found', async () => {
      mockFindUnique.mockResolvedValue(null)
      const session = await getSession('chat-1')
      expect(session).toBeNull()
    })

    it('returns session row when found', async () => {
      mockFindUnique.mockResolvedValue({
        externalChatId: 'chat-1',
        orgId: 'cust-1',
        internalCaseId: 'case-1',
        bridgeState: 'idle',
        textBuffer: '',
        metadata: { userId: 'user-1' },
      })
      const session = await getSession('chat-1')
      expect(session).toEqual({
        chatId: 'chat-1',
        orgId: 'cust-1',
        userId: 'user-1',
        caseId: 'case-1',
        state: 'idle',
        textBuffer: '',
      })
    })

    it('returns null on prisma error', async () => {
      mockFindUnique.mockRejectedValue(new Error('DB down'))
      const session = await getSession('chat-1')
      expect(session).toBeNull()
    })
  })

  describe('upsertSession', () => {
    it('upserts with correct data', async () => {
      mockUpsert.mockResolvedValue({})
      await upsertSession({ chatId: 'chat-1', orgId: 'cust-1', userId: 'user-1', caseId: 'case-1', state: 'idle', textBuffer: '' })
      expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { platform_externalChatId: { platform: 'livechat', externalChatId: 'chat-1' } },
      }))
    })
  })

  describe('updateSessionState', () => {
    it('updates state successfully', async () => {
      mockUpdate.mockResolvedValue({})
      await updateSessionState('chat-1', 'thinking')
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { platform_externalChatId: { platform: 'livechat', externalChatId: 'chat-1' } },
        data: { bridgeState: 'thinking' },
      })
    })
  })

  describe('closeSession', () => {
    it('sets status to archived', async () => {
      mockUpdate.mockResolvedValue({})
      await closeSession('chat-1', 'archived_by_agent')
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { platform_externalChatId: { platform: 'livechat', externalChatId: 'chat-1' } },
        data: { status: 'archived', bridgeState: 'idle' },
      })
    })
  })

  describe('text buffer persistence', () => {
    it('preserves split surrogate pairs across append + flush', async () => {
      const chatId = 'chat-emoji'
      rowStore.set(chatId, {
        externalChatId: chatId,
        orgId: 'cust-1',
        internalCaseId: 'case-emoji',
        bridgeState: 'idle',
        textBuffer: '',
        metadata: { userId: 'user-1' },
      })

      await appendTextBuffer(chatId, '\ud83d')
      await appendTextBuffer(chatId, '\udcb8 bonus')

      expect(rowStore.get(chatId)?.textBuffer).toBe(encodeLivechatTextBuffer('💸 bonus'))
      await expect(flushTextBuffer(chatId)).resolves.toBe('💸 bonus')
      expect(rowStore.get(chatId)?.textBuffer).toBe('')
    })
  })
})
