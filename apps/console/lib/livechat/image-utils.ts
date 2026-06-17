// apps/chat/lib/livechat/image-utils.ts
// Downloads images from external URLs and encodes as base64 for multimodal API.

const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const IMAGE_TYPE_ALIASES = new Map<string, string>([
  ['image/jpg', 'image/jpeg'],
  ['image/pjpeg', 'image/jpeg'],
])
const IMAGE_EXTENSION_TYPES = new Map<string, string>([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
])
const GENERIC_BINARY_TYPES = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
  'application/download',
])
const SUPPORTED_PREVIEW_PAGE_HOSTS = new Set(['postimg.cc', 'www.postimg.cc'])
const DIRECT_IMAGE_PATTERN = /\.(?:png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i

export interface DownloadResult {
  data: string
  contentType: string
}

export function normalizeImageContentType(contentType?: string | null): string | null {
  const normalized = contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!normalized) return null
  if (SUPPORTED_IMAGE_TYPES.has(normalized)) return normalized
  return IMAGE_TYPE_ALIASES.get(normalized) ?? null
}

function inferImageTypeFromPath(value?: string | null): string | null {
  if (!value) return null
  let pathname = value
  try {
    pathname = new URL(value).pathname
  } catch { /* value may be a filename, not a URL */ }

  const match = pathname.toLowerCase().match(/\.([a-z0-9]+)(?:$|[?#])/)
  if (!match?.[1]) return null
  return IMAGE_EXTENSION_TYPES.get(match[1]) ?? null
}

function inferImageTypeFromBytes(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png'
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  if (buffer.length >= 6) {
    const signature = buffer.subarray(0, 6).toString('ascii')
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif'
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

export function isLikelyImageAttachment(input: {
  contentType?: string | null
  filename?: string | null
  url?: string | null
}): boolean {
  return Boolean(
    normalizeImageContentType(input.contentType) ||
    inferImageTypeFromPath(input.filename) ||
    inferImageTypeFromPath(input.url),
  )
}

/** Download an image and return base64 data + verified content type. Throws if URL is unreachable or content is not a supported image type. */
export async function downloadAndEncode(
  url: string,
  fallback?: { contentType?: string | null; filename?: string | null },
): Promise<DownloadResult> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to download from ${url}: ${res.status}`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  const responseContentType = res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  const contentType =
    normalizeImageContentType(responseContentType) ||
    inferImageTypeFromBytes(buffer) ||
    (GENERIC_BINARY_TYPES.has(responseContentType)
      ? normalizeImageContentType(fallback?.contentType) ||
        inferImageTypeFromPath(fallback?.filename) ||
        inferImageTypeFromPath(url)
      : null)

  if (!contentType) {
    throw new Error(`Unsupported content type: ${responseContentType || 'unknown'}`)
  }
  return {
    data: buffer.toString('base64'),
    contentType,
  }
}

export function isSupportedImageType(contentType?: string): boolean {
  return Boolean(normalizeImageContentType(contentType))
}

export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>()]+/g) ?? []
  const cleaned = matches.map((url) => url.replace(/[),.;!?]+$/, ''))
  return Array.from(new Set(cleaned))
}

export function isDirectImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && (
      DIRECT_IMAGE_PATTERN.test(parsed.pathname) ||
      parsed.hostname === 'i.postimg.cc'
    )
  } catch {
    return false
  }
}

export function isResolvablePreviewPageUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && SUPPORTED_PREVIEW_PAGE_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}

function extractFirstMatch(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) return match[1]
  }
  return null
}

function resolveImageUrlFromHtml(pageUrl: URL, html: string): string | null {
  const raw = extractFirstMatch(html, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /id=["']download["'][^>]+href=["']([^"']+)["']/i,
    /<img[^>]+src=["']([^"']+)["'][^>]*>/i,
  ])
  if (!raw) return null

  try {
    const resolved = new URL(raw, pageUrl).toString()
    return isDirectImageUrl(resolved) ? resolved : null
  } catch {
    return null
  }
}

export async function resolvePreviewPageImageUrl(url: string): Promise<string | null> {
  if (!isResolvablePreviewPageUrl(url)) return null

  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Intera/1.0' },
  })
  if (!res.ok) return null

  const html = await res.text()
  return resolveImageUrlFromHtml(new URL(url), html)
}

export async function resolveRenderableImageUrls(text: string): Promise<string[]> {
  const urls = extractUrls(text)
  if (urls.length === 0) return []

  const resolved = await Promise.all(
    urls.map(async (url) => {
      if (isDirectImageUrl(url)) return url
      if (isResolvablePreviewPageUrl(url)) return resolvePreviewPageImageUrl(url)
      return null
    }),
  )

  return Array.from(new Set(resolved.filter((url): url is string => !!url)))
}
