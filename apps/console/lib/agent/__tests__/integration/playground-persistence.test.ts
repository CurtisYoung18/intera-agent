// Integration tests: playground session persistence
// These tests drive runPlaygroundTurn with a real PrismaPersistence.
// LLM calls are mocked (global provider mock from vitest-setup.ts).
// DB must be accessible (local DATABASE_URL points to prod via SSH tunnel).
//
// All tests are skipped by default — they need SSH tunnel to prod DB.
// To run: establish SSH tunnel, remove .skip, then:
//   env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npx vitest run apps/console/lib/agent/__tests__/integration/playground-persistence.test.ts

import { describe, it, expect } from 'vitest'

const TEST_USER_ID = 'test-playground-user'
const TEST_ORG_ID = 'test-org'

describe('playground session persistence', () => {
  // SKIP: requires DB access via SSH tunnel — verify in Phase 2 production test instead
  it.skip('creates a Case with type=playground on first turn', async () => {
    const { runPlaygroundTurn } = await import('../../playground-runner')
    const { prisma } = await import('@intera/shared/prisma')

    const events: any[] = []
    for await (const event of runPlaygroundTurn({
      orgId: TEST_ORG_ID,
      message: 'hello',
      playgroundConfig: { debug: false },
      userId: TEST_USER_ID,
    })) {
      events.push(event)
    }

    const sessionInit = events.find(e => e.type === 'session_init')
    expect(sessionInit).toBeDefined()
    expect(sessionInit.data.chatId).toBeTruthy()

    const dbCase = await prisma.case.findFirst({
      where: { chatId: sessionInit.data.chatId, type: 'playground', userId: TEST_USER_ID },
    })
    expect(dbCase).toBeDefined()
    expect(dbCase!.type).toBe('playground')
  })

  it.skip('loads history on second turn with same chatId', async () => {
    const { runPlaygroundTurn } = await import('../../playground-runner')
    const { prisma } = await import('@intera/shared/prisma')

    const events1: any[] = []
    for await (const event of runPlaygroundTurn({
      orgId: TEST_ORG_ID,
      message: 'first message',
      playgroundConfig: { debug: false },
      userId: TEST_USER_ID,
    })) {
      events1.push(event)
    }
    const chatId = (events1.find(e => e.type === 'session_init') as any).data.chatId

    const events2: any[] = []
    for await (const event of runPlaygroundTurn({
      orgId: TEST_ORG_ID,
      message: 'second message',
      playgroundConfig: { debug: false },
      userId: TEST_USER_ID,
      chatId,
    })) {
      events2.push(event)
    }

    const sessionInit2 = events2.find(e => e.type === 'session_init')
    expect(sessionInit2).toBeDefined()
    expect(sessionInit2.data.chatId).toBe(chatId)

    const dbCase = await prisma.case.findFirst({
      where: { chatId, type: 'playground' },
      include: { messages: true },
    })
    expect(dbCase!.messages.length).toBeGreaterThanOrEqual(2)
  })

  it.skip('DELETE session removes Case and messages', async () => {
    const { runPlaygroundTurn } = await import('../../playground-runner')
    const { prisma } = await import('@intera/shared/prisma')

    const events: any[] = []
    for await (const event of runPlaygroundTurn({
      orgId: TEST_ORG_ID,
      message: 'test message',
      playgroundConfig: { debug: false },
      userId: TEST_USER_ID,
    })) {
      events.push(event)
    }
    const chatId = (events.find(e => e.type === 'session_init') as any).data.chatId

    const c = await prisma.case.findFirst({ where: { chatId, type: 'playground' }, select: { id: true } })
    expect(c).toBeDefined()
    await prisma.case.delete({ where: { id: c!.id } })

    const deletedCase = await prisma.case.findFirst({ where: { chatId, type: 'playground' } })
    expect(deletedCase).toBeNull()
  })

  it.skip('caps sessions at MAX_PLAYGROUND_SESSIONS', async () => {
    const { runPlaygroundTurn } = await import('../../playground-runner')
    const { prisma } = await import('@intera/shared/prisma')

    const chatIds: string[] = []
    for (let i = 0; i < 6; i++) {
      const events: any[] = []
      for await (const event of runPlaygroundTurn({
        orgId: TEST_ORG_ID,
        message: `message ${i}`,
        playgroundConfig: { debug: false },
        userId: TEST_USER_ID,
      })) {
        events.push(event)
      }
      chatIds.push((events.find(e => e.type === 'session_init') as any).data.chatId)
    }

    const count = await prisma.case.count({
      where: { userId: TEST_USER_ID, type: 'playground' },
    })
    expect(count).toBeLessThanOrEqual(5)

    const oldestExists = await prisma.case.findFirst({
      where: { chatId: chatIds[0], type: 'playground' },
    })
    expect(oldestExists).toBeNull()
  })

  it.skip('isolates sessions between different userId', async () => {
    const { runPlaygroundTurn } = await import('../../playground-runner')
    const { prisma } = await import('@intera/shared/prisma')

    const eventsA: any[] = []
    for await (const event of runPlaygroundTurn({
      orgId: TEST_ORG_ID,
      message: 'user A message',
      playgroundConfig: { debug: false },
      userId: 'test-user-a',
    })) {
      eventsA.push(event)
    }
    const chatIdA = (eventsA.find(e => e.type === 'session_init') as any).data.chatId

    const caseForB = await prisma.case.findFirst({
      where: { chatId: chatIdA, type: 'playground', userId: 'test-user-b' },
    })
    expect(caseForB).toBeNull()

    await prisma.case.deleteMany({ where: { userId: 'test-user-a', type: 'playground' } })
    await prisma.case.deleteMany({ where: { userId: 'test-user-b', type: 'playground' } })
  })
})
