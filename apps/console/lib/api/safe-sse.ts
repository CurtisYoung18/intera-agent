import { normalizeSSEEvent } from '@/lib/agent/stream-handler'
import type { SSEEvent } from '@intera/shared/types'

function isClosedControllerError(error: unknown): boolean {
  return error instanceof TypeError
    && /controller is already closed|invalid state/i.test(error.message)
}

export function createSafeSseWriter(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder = new TextEncoder(),
) {
  let closed = false

  const close = () => {
    if (closed) return
    closed = true
    try {
      controller.close()
    } catch (error) {
      if (!isClosedControllerError(error)) throw error
    }
  }

  const sendEvent = (event: SSEEvent): boolean => {
    if (closed) return false
    const normalizedEvent = normalizeSSEEvent(event)
    try {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(normalizedEvent)}\n\n`),
      )
      return true
    } catch (error) {
      if (isClosedControllerError(error)) {
        closed = true
        return false
      }
      throw error
    }
  }

  return {
    close,
    isClosed: () => closed,
    sendEvent,
  }
}
