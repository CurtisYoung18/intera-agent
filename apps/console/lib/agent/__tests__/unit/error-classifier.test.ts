import { describe, it, expect } from 'vitest'
import { APIError, APIConnectionError, APIUserAbortError } from '@anthropic-ai/sdk'
import { classifyError, parseMaxTokensContextOverflow, type ErrorClass } from '../../api/error-classifier'

function makeApiError(status: number, message = '', errorBody?: unknown): APIError {
  return new APIError(status, errorBody ?? undefined, message, undefined)
}

describe('classifyError', () => {
  it('classifies APIUserAbortError as aborted', () => {
    expect(classifyError(new APIUserAbortError())).toBe('aborted')
  })

  it('classifies APIConnectionError as transient_network', () => {
    expect(classifyError(new APIConnectionError({ message: 'connection failed' } as any))).toBe('transient_network')
  })

  it('classifies 529 as overloaded', () => {
    expect(classifyError(makeApiError(529))).toBe('overloaded')
  })

  it('classifies overloaded_error in message body as overloaded', () => {
    expect(classifyError(makeApiError(500, 'overloaded_error: try again'))).toBe('overloaded')
  })

  it('classifies overloaded_error in error body as overloaded', () => {
    const err = makeApiError(503, '', 'overloaded_error message')
    expect(classifyError(err)).toBe('overloaded')
  })

  it('classifies overloaded_error JSON type string in message as overloaded', () => {
    expect(classifyError(makeApiError(500, '"type":"overloaded_error"'))).toBe('overloaded')
  })

  it('classifies 429 as rate_limit', () => {
    expect(classifyError(makeApiError(429))).toBe('rate_limit')
  })

  it('classifies 408 as timeout', () => {
    expect(classifyError(makeApiError(408))).toBe('timeout')
  })

  it('classifies 401 as auth', () => {
    expect(classifyError(makeApiError(401))).toBe('auth')
  })

  it('classifies 403 as auth', () => {
    expect(classifyError(makeApiError(403))).toBe('auth')
  })

  it('classifies 400 with context overflow message as context_overflow', () => {
    expect(classifyError(makeApiError(400, 'prompt is too long: 200000 tokens > 199999 maximum'))).toBe('context_overflow')
  })

  it('classifies 400 with context_length_exceeded as context_overflow', () => {
    expect(classifyError(makeApiError(400, 'context_length_exceeded error'))).toBe('context_overflow')
  })

  it('classifies 400 without context overflow as malformed_request', () => {
    expect(classifyError(makeApiError(400, 'bad request syntax'))).toBe('malformed_request')
  })

  it('classifies 500+ as server_error', () => {
    expect(classifyError(makeApiError(500))).toBe('server_error')
    expect(classifyError(makeApiError(502))).toBe('server_error')
    expect(classifyError(makeApiError(503))).toBe('server_error')
  })

  it('classifies context_length_exceeded in generic message as context_overflow', () => {
    expect(classifyError(makeApiError(413, 'request contains context_length_exceeded'))).toBe('context_overflow')
  })

  it('classifies raw ECONNRESET as transient_network', () => {
    expect(classifyError(new Error('ECONNRESET'))).toBe('transient_network')
  })

  it('classifies raw EPIPE as transient_network', () => {
    expect(classifyError(new Error('EPIPE'))).toBe('transient_network')
  })

  it('classifies raw socket hang up as transient_network', () => {
    expect(classifyError(new Error('socket hang up'))).toBe('transient_network')
  })

  it('classifies raw abort message as aborted', () => {
    expect(classifyError(new Error('aborted'))).toBe('aborted')
  })

  it('classifies raw "abort" in message as aborted', () => {
    expect(classifyError(new Error('The operation was aborted'))).toBe('aborted')
  })

  it('classifies unknown error as unknown', () => {
    expect(classifyError(new Error('something weird happened'))).toBe('unknown')
  })

  it('classifies non-Error values as unknown', () => {
    expect(classifyError('just a string')).toBe('unknown')
  })

  it('classifies context overflow from structured error body', () => {
    const err = makeApiError(400, '', JSON.stringify({
      type: 'invalid_request_error',
      message: 'prompt is too long: 250000 tokens > 199999 maximum',
    }))
    expect(classifyError(err)).toBe('context_overflow')
  })

  it('classifies structured error with context_length_exceeded body as context_overflow', () => {
    const err = makeApiError(400, '', JSON.stringify({
      type: 'invalid_request_error',
      message: 'context_length_exceeded',
    }))
    expect(classifyError(err)).toBe('context_overflow')
  })
})

describe('parseMaxTokensContextOverflow', () => {
  it('parses Anthropic format correctly', () => {
    const result = parseMaxTokensContextOverflow(new Error('prompt is too long: 200000 tokens > 199999 maximum'))
    expect(result).toEqual({
      inputTokens: 200000,
      maxTokens: 0,
      contextLimit: 199999,
    })
  })

  it('parses with commas in numbers', () => {
    const result = parseMaxTokensContextOverflow(new Error('prompt is too long: 1,200,000 tokens > 1,000,000 maximum'))
    expect(result).toEqual({
      inputTokens: 1200000,
      maxTokens: 0,
      contextLimit: 1000000,
    })
  })

  it('returns null for non-matching error message', () => {
    expect(parseMaxTokensContextOverflow(new Error('some other error'))).toBeNull()
  })

  it('returns null for non-Error values', () => {
    expect(parseMaxTokensContextOverflow('just a string')).toBeNull()
  })

  it('returns null for null/undefined', () => {
    expect(parseMaxTokensContextOverflow(null)).toBeNull()
    expect(parseMaxTokensContextOverflow(undefined)).toBeNull()
  })

  it('handles error with no message', () => {
    const err = new Error()
    err.message = ''
    expect(parseMaxTokensContextOverflow(err)).toBeNull()
  })
})
