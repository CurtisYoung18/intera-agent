import { describe, expect, it, vi } from 'vitest'

import { createSafeSseWriter } from '@/lib/api/safe-sse'

function decodeChunk(chunk: Uint8Array): unknown {
  const text = new TextDecoder().decode(chunk)
  return JSON.parse(text.replace(/^data: /, '').trim())
}

describe('createSafeSseWriter', () => {
  it('encodes normalized SSE events', () => {
    const chunks: Uint8Array[] = []
    const controller = {
      enqueue: vi.fn((chunk: Uint8Array) => {
        chunks.push(chunk)
      }),
      close: vi.fn(),
    } as unknown as ReadableStreamDefaultController<Uint8Array>

    const writer = createSafeSseWriter(controller)
    const sent = writer.sendEvent({ type: 'message_stop' } as any)

    expect(sent).toBe(true)
    expect(chunks).toHaveLength(1)
    expect(decodeChunk(chunks[0] as Uint8Array)).toMatchObject({ type: 'message_stop' })
  })

  it('makes close idempotent and drops later events', () => {
    const controller = {
      enqueue: vi.fn(),
      close: vi.fn(),
    } as unknown as ReadableStreamDefaultController<Uint8Array>

    const writer = createSafeSseWriter(controller)
    writer.close()
    writer.close()

    expect(writer.isClosed()).toBe(true)
    expect(controller.close).toHaveBeenCalledTimes(1)
    expect(writer.sendEvent({ type: 'text_delta', data: 'later' } as any)).toBe(false)
    expect(controller.enqueue).not.toHaveBeenCalled()
  })

  it('absorbs already-closed enqueue errors and marks the stream closed', () => {
    const controller = {
      enqueue: vi.fn(() => {
        throw new TypeError('Invalid state: Controller is already closed')
      }),
      close: vi.fn(() => {
        throw new TypeError('Invalid state: Controller is already closed')
      }),
    } as unknown as ReadableStreamDefaultController<Uint8Array>

    const writer = createSafeSseWriter(controller)

    expect(writer.sendEvent({ type: 'error', data: 'boom' } as any)).toBe(false)
    expect(writer.isClosed()).toBe(true)
    expect(() => writer.close()).not.toThrow()
  })

  it('rethrows unexpected controller failures', () => {
    const controller = {
      enqueue: vi.fn(() => {
        throw new Error('socket corrupted')
      }),
      close: vi.fn(),
    } as unknown as ReadableStreamDefaultController<Uint8Array>

    const writer = createSafeSseWriter(controller)

    expect(() => writer.sendEvent({ type: 'error', data: 'boom' } as any)).toThrow('socket corrupted')
  })
})
