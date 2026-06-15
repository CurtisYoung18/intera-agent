'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ContentBlock } from '@intera/shared/types'

interface PreviewItem {
  id: string
  imageUrl: string
  href: string
  alt: string
}

const previewCache = new Map<string, string | null>()
const directImagePattern = /\.(?:png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i

function extractUrls(content: string): string[] {
  const matches = content.match(/https?:\/\/[^\s<>()]+/g) ?? []
  const cleaned = matches.map((url) => url.replace(/[),.;!?]+$/, ''))
  return Array.from(new Set(cleaned))
}

function isDirectImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && (directImagePattern.test(parsed.pathname) || parsed.hostname === 'i.postimg.cc')
  } catch {
    return false
  }
}

function isPostimgPageUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && (parsed.hostname === 'postimg.cc' || parsed.hostname === 'www.postimg.cc')
  } catch {
    return false
  }
}

function previewAltText(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname
  } catch {
    return 'message image'
  }
}

export default function MessageImagePreviews({
  content,
  contentBlocks,
}: {
  content: string
  contentBlocks?: ContentBlock[]
}) {
  const base64Previews = useMemo<PreviewItem[]>(() => {
    return (contentBlocks ?? [])
      .filter((block): block is Extract<ContentBlock, { type: 'image' }> => block.type === 'image')
      .map((block, index) => ({
        id: `base64-${index}`,
        imageUrl: `data:${block.source.media_type};base64,${block.source.data}`,
        href: `data:${block.source.media_type};base64,${block.source.data}`,
        alt: `attached image ${index + 1}`,
      }))
  }, [contentBlocks])

  const contentUrls = useMemo(() => extractUrls(content), [content])
  const directUrlPreviews = useMemo<PreviewItem[]>(() => {
    return contentUrls
      .filter(isDirectImageUrl)
      .map((url) => ({
        id: `direct:${url}`,
        imageUrl: url,
        href: url,
        alt: previewAltText(url),
      }))
  }, [contentUrls])

  const postimgPageUrls = useMemo(
    () => contentUrls.filter((url) => !isDirectImageUrl(url) && isPostimgPageUrl(url)),
    [contentUrls],
  )

  const [resolvedPostimgUrls, setResolvedPostimgUrls] = useState<Record<string, string | null>>(() => {
    const initial: Record<string, string | null> = {}
    for (const url of postimgPageUrls) {
      if (previewCache.has(url)) initial[url] = previewCache.get(url) ?? null
    }
    return initial
  })

  useEffect(() => {
    let cancelled = false

    async function resolvePending() {
      const pending = postimgPageUrls.filter((url) => !previewCache.has(url))
      if (pending.length === 0) {
        setResolvedPostimgUrls((prev) => {
          const next = { ...prev }
          for (const url of postimgPageUrls) {
            if (previewCache.has(url)) next[url] = previewCache.get(url) ?? null
          }
          return next
        })
        return
      }

      const entries = await Promise.all(
        pending.map(async (url) => {
          try {
            const res = await fetch(`/api/media/resolve-image?url=${encodeURIComponent(url)}`)
            if (!res.ok) return [url, null] as const
            const body = await res.json()
            const imageUrl = body?.ok === true ? body.data?.imageUrl : null
            return [url, typeof imageUrl === 'string' && imageUrl.length > 0 ? imageUrl : null] as const
          } catch {
            return [url, null] as const
          }
        }),
      )

      if (cancelled) return

      setResolvedPostimgUrls((prev) => {
        const next = { ...prev }
        for (const [url, imageUrl] of entries) {
          previewCache.set(url, imageUrl)
          next[url] = imageUrl
        }
        for (const url of postimgPageUrls) {
          if (previewCache.has(url)) next[url] = previewCache.get(url) ?? null
        }
        return next
      })
    }

    void resolvePending()
    return () => {
      cancelled = true
    }
  }, [postimgPageUrls])

  const postimgPreviews = useMemo<PreviewItem[]>(() => {
    return postimgPageUrls.flatMap((url) => {
      const imageUrl = resolvedPostimgUrls[url]
      if (!imageUrl) return []
      return [{
        id: `postimg:${url}`,
        imageUrl,
        href: url,
        alt: previewAltText(url),
      }]
    })
  }, [postimgPageUrls, resolvedPostimgUrls])

  const previews = [...base64Previews, ...directUrlPreviews, ...postimgPreviews]
  if (previews.length === 0) return null

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
      {previews.map((preview) => (
        <a
          key={preview.id}
          href={preview.href}
          target="_blank"
          rel="noreferrer"
          style={{ display: 'inline-flex' }}
        >
          <img
            src={preview.imageUrl}
            alt={preview.alt}
            loading="lazy"
            style={{
              maxWidth: 220,
              maxHeight: 180,
              borderRadius: 12,
              objectFit: 'cover',
              border: '1px solid rgba(0,0,0,0.08)',
              boxShadow: '0 8px 24px rgba(24, 18, 14, 0.08)',
              background: 'rgba(255,255,255,0.9)',
            }}
          />
        </a>
      ))}
    </div>
  )
}
