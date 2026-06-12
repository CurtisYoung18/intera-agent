import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  mockGetActiveOrgId: vi.fn(),
  mockGetActiveVendor: vi.fn(),
  mockRunPlaygroundTurn: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getActiveOrgId: h.mockGetActiveOrgId,
  getActiveVendor: h.mockGetActiveVendor,
}))

vi.mock('@/lib/agent/playground-runner', () => ({
  runPlaygroundTurn: h.mockRunPlaygroundTurn,
}))

import { POST } from '@/app/api/admin/playground/run/route'

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/admin/playground/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as any
}

async function readSse(res: Response) {
  const text = await res.text()
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((chunk) => JSON.parse(chunk.replace(/^data: /, '')))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetActiveOrgId.mockResolvedValue('org-1')
  h.mockGetActiveVendor.mockResolvedValue({ isAuthed: true, userId: 'user-1' })
  h.mockRunPlaygroundTurn.mockImplementation(async function* (input: unknown) {
    yield { type: 'trace', data: { input }, timestamp: '2026-06-10T00:00:00.000Z' }
    yield { type: 'message_stop', data: { transition: 'next_turn' }, timestamp: '2026-06-10T00:00:00.000Z' }
  })
})

describe('POST /api/admin/playground/run', () => {
  it('passes contentBlocks through to runPlaygroundTurn', async () => {
    const contentBlocks = [{
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
    }]

    const res = await POST(makeRequest({
      message: 'What is in this image?',
      configId: 'agent-1',
      contentBlocks,
      config: { debug: true },
      chatId: 'pg_agent-1_1_x',
    }))

    expect(res.status).toBe(200)
    const events = await readSse(res)
    expect(events.some((event) => event.type === 'trace')).toBe(true)
    expect(h.mockRunPlaygroundTurn).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      userId: 'user-1',
      message: 'What is in this image?',
      configId: 'agent-1',
      chatId: 'pg_agent-1_1_x',
      playgroundConfig: { debug: true, toolExecutionMode: 'runtime' },
      contentBlocks,
    }))
  })

  it('allows explicit dry-run mode for side-effect-safe debugging', async () => {
    const res = await POST(makeRequest({
      message: 'hello',
      configId: 'agent-1',
      config: { debug: false, toolExecutionMode: 'dry_run' },
    }))

    expect(res.status).toBe(200)
    expect(h.mockRunPlaygroundTurn).toHaveBeenCalledWith(expect.objectContaining({
      playgroundConfig: { debug: false, toolExecutionMode: 'dry_run' },
    }))
  })

  it('returns typed 401 when admin session is missing', async () => {
    h.mockGetActiveVendor.mockResolvedValue({ isAuthed: false })

    const res = await POST(makeRequest({ message: 'hello' }))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('unauthorized')
  })
})
