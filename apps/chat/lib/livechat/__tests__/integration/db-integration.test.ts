import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// These tests hit the real Railway PostgreSQL database.
// Set DATABASE_URL env var before running.

const TEST_CHAT_ID = `test-chat-${Date.now()}`
const TEST_CUSTOMER = 'default'

describe('DB integration tests (Railway PostgreSQL)', () => {
  // Lazy imports to ensure env is loaded
  let getSession: typeof import('../../session-store').getSession
  let upsertSession: typeof import('../../session-store').upsertSession
  let updateSessionState: typeof import('../../session-store').updateSessionState
  let closeSession: typeof import('../../session-store').closeSession

  let isDuplicateWebhook: typeof import('../../webhook-dedup').isDuplicateWebhook
  let pruneOldWebhookEvents: typeof import('../../webhook-dedup').pruneOldWebhookEvents

  let markChannelUnhealthy: typeof import('../../channel-health').markChannelUnhealthy
  let markChannelHealthy: typeof import('../../channel-health').markChannelHealthy
  let getChannelHealth: typeof import('../../channel-health').getChannelHealth

  let enqueueRetry: typeof import('../../retry-queue').enqueueRetry

  beforeAll(async () => {
    const sessionMod = await import('../../session-store')
    getSession = sessionMod.getSession
    upsertSession = sessionMod.upsertSession
    updateSessionState = sessionMod.updateSessionState
    closeSession = sessionMod.closeSession

    const dedupMod = await import('../../webhook-dedup')
    isDuplicateWebhook = dedupMod.isDuplicateWebhook
    pruneOldWebhookEvents = dedupMod.pruneOldWebhookEvents

    const healthMod = await import('../../channel-health')
    markChannelUnhealthy = healthMod.markChannelUnhealthy
    markChannelHealthy = healthMod.markChannelHealthy
    getChannelHealth = healthMod.getChannelHealth

    const retryMod = await import('../../retry-queue')
    enqueueRetry = retryMod.enqueueRetry
  })

  describe('session-store (PostgreSQL)', () => {
    it('getSession returns null for non-existent chat', async () => {
      const session = await getSession(`non-existent-${Date.now()}`)
      expect(session).toBeNull()
    })

    it('upsertSession + getSession round-trip', async () => {
      const chatId = `${TEST_CHAT_ID}-session`
      await upsertSession({
        chatId, orgId: TEST_CUSTOMER, userId: 'user-1',
        caseId: 'case-1', state: 'idle', textBuffer: '',
      })
      const session = await getSession(chatId)
      expect(session).not.toBeNull()
      expect(session!.chatId).toBe(chatId)
      expect(session!.state).toBe('idle')
    })

    it('updateSessionState changes bridgeState', async () => {
      const chatId = `${TEST_CHAT_ID}-state`
      await upsertSession({
        chatId, orgId: TEST_CUSTOMER, userId: 'user-1',
        caseId: 'case-2', state: 'idle', textBuffer: '',
      })
      await updateSessionState(chatId, 'thinking')
      const session = await getSession(chatId)
      expect(session!.state).toBe('thinking')
    })

    it('updateSessionState does not throw on non-existent chat', async () => {
      await expect(updateSessionState(`ghost-${Date.now()}`, 'idle')).resolves.toBeUndefined()
    })

    it('closeSession archives the conversation', async () => {
      const chatId = `${TEST_CHAT_ID}-close`
      await upsertSession({
        chatId, orgId: TEST_CUSTOMER, userId: 'user-1',
        caseId: 'case-3', state: 'idle', textBuffer: '',
      })
      await closeSession(chatId, 'archived_by_agent')
      const session = await getSession(chatId)
      // After archival, the session should still exist but state changed
      expect(session).not.toBeNull()
    })

    it('closeSession does not throw on non-existent chat', async () => {
      await expect(closeSession(`ghost-close-${Date.now()}`, 'test')).resolves.toBeUndefined()
    })
  })

  describe('webhook-dedup (PostgreSQL)', () => {
    it('isDuplicateWebhook returns false on first call', async () => {
      const id = `dedup-test-${Date.now()}`
      const result = await isDuplicateWebhook(id)
      expect(result).toBe(false)
    })

    it('isDuplicateWebhook returns true on duplicate', async () => {
      const id = `dedup-dup-${Date.now()}`
      const first = await isDuplicateWebhook(id)
      expect(first).toBe(false)
      const second = await isDuplicateWebhook(id)
      expect(second).toBe(true)
    })

    it('pruneOldWebhookEvents completes without error', async () => {
      await expect(pruneOldWebhookEvents(365)).resolves.toBeUndefined()
    })
  })

  describe('channel-health (PostgreSQL)', () => {
    it('markChannelUnhealthy + getChannelHealth round-trip', async () => {
      const cid = `health-${Date.now()}`
      await markChannelUnhealthy(cid, 'livechat', 'token_expired', 'test error')
      const health = await getChannelHealth(cid, 'livechat')
      expect(health).not.toBeNull()
      expect(health!.status).toBe('token_expired')
      expect(health!.lastError).toBe('test error')
    })

    it('markChannelHealthy transitions to healthy', async () => {
      const cid = `health-recover-${Date.now()}`
      await markChannelUnhealthy(cid, 'livechat', 'token_expired', 'err')
      await markChannelHealthy(cid, 'livechat')
      const health = await getChannelHealth(cid, 'livechat')
      expect(health!.status).toBe('healthy')
      expect(health!.lastError).toBeNull()
    })

    it('getChannelHealth returns null for missing', async () => {
      const health = await getChannelHealth(`no-health-${Date.now()}`, 'livechat')
      expect(health).toBeNull()
    })
  })

  describe('retry-queue (PostgreSQL)', () => {
    it('enqueueRetry creates pending event', async () => {
      await expect(enqueueRetry(
        `${TEST_CHAT_ID}-retry`, TEST_CUSTOMER, 'user-1',
        { type: 'message', text: 'hello' }, 'Network error',
      )).resolves.toBeUndefined()
    })
  })
})
