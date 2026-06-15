'use client'

import { Fragment, createElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ContentBlock } from '@intera/shared/types'
import MessageImagePreviews from './message-image-previews'

const directImagePattern = /\.(?:png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i

function isRenderableMarkdownImageUrl(src: string | undefined): src is string {
  if (!src) return false

  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(src)) return true
  if (directImagePattern.test(src)) return true

  try {
    const parsed = new URL(src)
    return parsed.protocol === 'https:' && (directImagePattern.test(parsed.pathname) || parsed.hostname === 'i.postimg.cc')
  } catch {
    return false
  }
}

export default function MessageContent({
  content,
  contentBlocks,
  imagePreviewMode = 'none',
}: {
  content: string
  contentBlocks?: ContentBlock[]
  imagePreviewMode?: 'none' | 'auto'
}) {
  const main = content.startsWith('Tool ')
    ? createElement('pre', { className: 'whitespace-pre-wrap break-words' }, content)
    : createElement(ReactMarkdown, {
      remarkPlugins: [remarkGfm],
      components: {
        a: ({ href, children }) => createElement(
          'a',
          {
            href,
            target: '_blank',
            rel: 'noreferrer',
            style: { wordBreak: 'break-word' },
          },
          children,
        ),
        img: ({ src, alt }) => {
          const imageSrc = typeof src === 'string' ? src : undefined
          if (!isRenderableMarkdownImageUrl(imageSrc)) {
            if (!imageSrc) return createElement('span', null, alt || 'image link')

            return createElement(
              'a',
              {
                href: imageSrc,
                target: '_blank',
                rel: 'noreferrer',
                style: { wordBreak: 'break-word' },
              },
              alt || imageSrc || 'image link',
            )
          }

          return createElement('img', {
            src: imageSrc,
            alt: alt ?? '',
            loading: 'lazy',
            style: {
              display: 'block',
              maxWidth: 'min(100%, 420px)',
              borderRadius: 12,
              marginTop: 10,
              border: '1px solid rgba(0,0,0,0.08)',
              boxShadow: '0 8px 24px rgba(24, 18, 14, 0.08)',
            },
          })
        },
      },
    }, content)

  if (imagePreviewMode !== 'auto') return main

  return createElement(Fragment, null,
    main,
    createElement(MessageImagePreviews, { content, contentBlocks }),
  )
}
