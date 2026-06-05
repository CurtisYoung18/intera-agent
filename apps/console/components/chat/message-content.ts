'use client'

import { createElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export default function MessageContent({ content }: { content: string }) {
  if (content.startsWith('Tool ')) {
    return createElement('pre', { className: 'whitespace-pre-wrap break-words' }, content)
  }
  return createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, content)
}
