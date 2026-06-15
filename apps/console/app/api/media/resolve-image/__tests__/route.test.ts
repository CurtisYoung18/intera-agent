import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  repoForOrg: vi.fn(() => ({})),
}))

vi.mock('@/lib/db/repo-for-org', () => ({ repoForOrg: h.repoForOrg }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { GET } from '@/app/api/media/resolve-image/route'

function makeRequest(url: string) {
  return new NextRequest(`http://localhost/api/media/resolve-image?url=${encodeURIComponent(url)}`, {
    method: 'GET',
  })
}

describe('GET /api/media/resolve-image', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    h.repoForOrg.mockReturnValue({})
  })

  it('extracts the direct image URL from a postimg page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><head><meta property="og:image" content="https://i.postimg.cc/example/demo.jpg"></head></html>',
    }))

    const res = await GET(makeRequest('https://postimg.cc/abc123'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.imageUrl).toBe('https://i.postimg.cc/example/demo.jpg')
  })

  it('rejects unsupported hosts', async () => {
    const res = await GET(makeRequest('https://example.com/not-supported'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('validation')
  })
})
