// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import MessageContent from '../message-content'

describe('MessageContent', () => {
  it('renders bold markdown', () => {
    const { container } = render(createElement(MessageContent, { content: '**bold**' }))
    expect(container.querySelector('strong')).toBeTruthy()
  })

  it('renders unordered list', () => {
    const { container } = render(createElement(MessageContent, { content: '- a\n- b' }))
    expect(container.querySelector('ul')).toBeTruthy()
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  it('renders tool results as pre', () => {
    const { container } = render(createElement(MessageContent, { content: 'Tool result: something' }))
    const pre = container.querySelector('pre')
    expect(pre).toBeTruthy()
    expect(pre!.className).toContain('whitespace-pre-wrap')
  })

  it('does not execute raw HTML (XSS safe)', () => {
    const { container } = render(createElement(MessageContent, { content: "<script>alert('xss')</script>" }))
    expect(container.querySelector('script')).toBeNull()
    // React renders escaped HTML, so the content is safe
    expect(container.innerHTML).not.toContain('<script>')
  })

  it('renders inline code', () => {
    const { container } = render(createElement(MessageContent, { content: 'use `code` here' }))
    expect(container.querySelector('code')).toBeTruthy()
  })

  it('renders content that does not start with "Tool " as markdown', () => {
    const { container } = render(createElement(MessageContent, { content: 'Something with Tool mentioned' }))
    // Should be treated as markdown, not pre (note: `Tool ` with trailing space is the check)
    expect(container.querySelector('pre')).toBeNull()
  })

  it('renders heading markdown', () => {
    const { container } = render(createElement(MessageContent, { content: '## Heading' }))
    expect(container.querySelector('h2')).toBeTruthy()
  })

  it('renders code block with language', () => {
    const { container } = render(createElement(MessageContent, { content: '```ts\nconst x = 1\n```' }))
    expect(container.querySelector('code')).toBeTruthy()
  })
})
