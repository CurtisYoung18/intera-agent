// apps/chat/lib/livechat/image-utils.ts
// Downloads images from external URLs and encodes as base64 for multimodal API.

const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export interface DownloadResult {
  data: string
  contentType: string
}

/** Download an image and return base64 data + verified content type. Throws if URL is unreachable or content is not a supported image type. */
export async function downloadAndEncode(url: string): Promise<DownloadResult> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to download from ${url}: ${res.status}`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  const contentType = res.headers.get('content-type')?.split(';')[0]?.trim() ?? 'application/octet-stream'
  if (!SUPPORTED_IMAGE_TYPES.has(contentType)) {
    throw new Error(`Unsupported content type: ${contentType}`)
  }
  return {
    data: buffer.toString('base64'),
    contentType,
  }
}

export function isSupportedImageType(contentType?: string): boolean {
  return !!contentType && SUPPORTED_IMAGE_TYPES.has(contentType)
}
