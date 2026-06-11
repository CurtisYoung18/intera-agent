import { describe, expect, it } from 'vitest'

import { decodeLivechatTextBuffer, encodeLivechatTextBuffer } from '../../text-buffer-codec'

describe('text-buffer-codec', () => {
  it('round-trips plain text through the storage codec', () => {
    const encoded = encodeLivechatTextBuffer('hello world')
    expect(decodeLivechatTextBuffer(encoded)).toBe('hello world')
  })

  it('preserves split surrogate pairs when chunks are re-encoded between appends', () => {
    const firstChunk = '\ud83d'
    const secondChunk = '\udcb8 done'

    const partial = decodeLivechatTextBuffer(encodeLivechatTextBuffer(firstChunk))
    const completed = decodeLivechatTextBuffer(encodeLivechatTextBuffer(partial + secondChunk))

    expect(completed).toBe('💸 done')
  })

  it('falls back to legacy plain-text values', () => {
    expect(decodeLivechatTextBuffer('legacy text')).toBe('legacy text')
  })
})
