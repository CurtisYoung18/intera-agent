import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  downloadAndEncode,
  extractUrls,
  isLikelyImageAttachment,
  isDirectImageUrl,
  isResolvablePreviewPageUrl,
  isSupportedImageType,
  normalizeImageContentType,
  resolvePreviewPageImageUrl,
  resolveRenderableImageUrls,
} from '../../image-utils'

describe('downloadAndEncode', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('downloads and encodes image as base64', async () => {
    const pngData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(pngData.buffer),
      headers: { get: () => 'image/png' },
    }))

    const result = await downloadAndEncode('https://example.com/image.png')
    expect(result.data).toBe(Buffer.from(pngData).toString('base64'))
    expect(result.contentType).toBe('image/png')
  })

  it('accepts generic LiveChat downloads when the filename identifies the image type', async () => {
    const imageData = new Uint8Array([1, 2, 3, 4])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(imageData.buffer),
      headers: { get: () => 'application/octet-stream' },
    }))

    const result = await downloadAndEncode('https://files.livechatinc.com/download', { filename: 'receipt.jpg' })
    expect(result.data).toBe(Buffer.from(imageData).toString('base64'))
    expect(result.contentType).toBe('image/jpeg')
  })

  it('throws on non-image content type', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'application/pdf' },
    }))
    await expect(downloadAndEncode('https://example.com/doc.pdf')).rejects.toThrow('Unsupported content type')
  })

  it('throws on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    await expect(downloadAndEncode('https://example.com/missing.png')).rejects.toThrow('Failed to download from')
  })
})

describe('isSupportedImageType', () => {
  it('returns true for png/jpeg/gif/webp', () => {
    expect(isSupportedImageType('image/png')).toBe(true)
    expect(isSupportedImageType('image/jpeg')).toBe(true)
    expect(isSupportedImageType('image/jpg')).toBe(true)
    expect(isSupportedImageType('image/png; charset=binary')).toBe(true)
    expect(isSupportedImageType('image/gif')).toBe(true)
    expect(isSupportedImageType('image/webp')).toBe(true)
  })

  it('returns false for non-image types', () => {
    expect(isSupportedImageType('application/pdf')).toBe(false)
    expect(isSupportedImageType('application/octet-stream')).toBe(false)
    expect(isSupportedImageType(undefined)).toBe(false)
    expect(isSupportedImageType('')).toBe(false)
  })

  it('normalizes aliases and detects likely image attachments', () => {
    expect(normalizeImageContentType('IMAGE/JPG')).toBe('image/jpeg')
    expect(isLikelyImageAttachment({
      contentType: 'application/octet-stream',
      filename: 'receipt.png',
      url: 'https://files.livechatinc.com/download',
    })).toBe(true)
    expect(isLikelyImageAttachment({
      contentType: 'application/octet-stream',
      filename: 'receipt.pdf',
      url: 'https://files.livechatinc.com/download',
    })).toBe(false)
  })
})

describe('image preview helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('extracts deduplicated urls while trimming trailing punctuation', () => {
    expect(
      extractUrls('See https://postimg.cc/abc123, and https://example.com/demo.png. https://postimg.cc/abc123'),
    ).toEqual([
      'https://postimg.cc/abc123',
      'https://example.com/demo.png',
    ])
  })

  it('detects direct image urls and resolvable preview pages', () => {
    expect(isDirectImageUrl('https://example.com/demo.png')).toBe(true)
    expect(isDirectImageUrl('https://i.postimg.cc/abc/demo.jpg')).toBe(true)
    expect(isDirectImageUrl('https://postimg.cc/abc123')).toBe(false)

    expect(isResolvablePreviewPageUrl('https://postimg.cc/abc123')).toBe(true)
    expect(isResolvablePreviewPageUrl('https://www.postimg.cc/abc123')).toBe(true)
    expect(isResolvablePreviewPageUrl('https://example.com/demo.png')).toBe(false)
  })

  it('resolves preview page html to the direct image url', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><head><meta property="og:image" content="https://i.postimg.cc/example/demo.jpg"></head></html>',
    }))

    await expect(resolvePreviewPageImageUrl('https://postimg.cc/abc123')).resolves.toBe(
      'https://i.postimg.cc/example/demo.jpg',
    )
  })

  it('returns direct images and resolved preview page images together', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><head><meta property="og:image" content="https://i.postimg.cc/example/demo.jpg"></head></html>',
    }))

    await expect(
      resolveRenderableImageUrls('A https://postimg.cc/abc123 B https://example.com/guide.png C https://example.com/page'),
    ).resolves.toEqual([
      'https://i.postimg.cc/example/demo.jpg',
      'https://example.com/guide.png',
    ])
  })
})
