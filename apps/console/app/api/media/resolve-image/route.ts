import { z } from 'zod'
import { defineRoute, ValidationError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'

const querySchema = z.object({
  url: z.string().url(),
})

const SUPPORTED_PAGE_HOSTS = new Set(['postimg.cc', 'www.postimg.cc'])

function extractFirstMatch(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) return match[1]
  }
  return null
}

function resolveImageUrl(pageUrl: URL, html: string): string | null {
  const raw = extractFirstMatch(html, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /id=["']download["'][^>]+href=["']([^"']+)["']/i,
    /<img[^>]+src=["']([^"']+)["'][^>]*>/i,
  ])
  if (!raw) return null

  try {
    const resolved = new URL(raw, pageUrl).toString()
    return resolved.startsWith('https://') ? resolved : null
  } catch {
    return null
  }
}

export const GET = defineRoute<z.infer<typeof querySchema>>({
  method: 'GET',
  auth: 'none',
  parseQuery: true,
  inputSchema: querySchema,
  async handler({ input }) {
    const pageUrl = new URL(input.url)
    if (pageUrl.protocol !== 'https:' || !SUPPORTED_PAGE_HOSTS.has(pageUrl.hostname)) {
      throw new ValidationError('Unsupported image preview host')
    }

    const res = await fetch(pageUrl.toString(), {
      redirect: 'follow',
      headers: { 'User-Agent': 'Intera/1.0' },
    })
    if (!res.ok) {
      throw new ValidationError(`Preview page fetch failed (HTTP ${res.status})`)
    }

    const html = await res.text()
    return apiOk({ imageUrl: resolveImageUrl(pageUrl, html) })
  },
})
