// apps/chat/lib/livechat/image-utils.ts
// Downloads images from external URLs and encodes as base64 for multimodal API.

const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const SUPPORTED_PREVIEW_PAGE_HOSTS = new Set(['postimg.cc', 'www.postimg.cc'])
const DIRECT_IMAGE_PATTERN = /\.(?:png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i

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
