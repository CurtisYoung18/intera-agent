import { describe, it, expect, vi, beforeEach } from 'vitest'
import { downloadAndEncode } from '../../image-utils'

describe('downloadAndEncode', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('downloads and encodes image as base64', async () => {
    const pngData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) // PNG header
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(pngData.buffer),
    }))

    const result = await downloadAndEncode('https://example.com/image.png')
    expect(result).toBe(Buffer.from(pngData).toString('base64'))
  })

  it('throws on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    await expect(downloadAndEncode('https://example.com/missing.png')).rejects.toThrow('Failed to download image')
  })
})
