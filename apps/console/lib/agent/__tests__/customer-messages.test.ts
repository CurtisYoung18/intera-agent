import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  detectCustomerLocale,
  escalationMessageFor,
  ESCALATION_TO_HUMAN,
} from '../customer-messages'

describe('detectCustomerLocale', () => {
  it('returns "en" for plain English', () => {
    expect(detectCustomerLocale('hello')).toBe('en')
  })

  it('returns "zh" for Chinese text', () => {
    expect(detectCustomerLocale('你好')).toBe('zh')
  })

  it('returns "zh" when CJK chars are mixed with latin', () => {
    expect(detectCustomerLocale('hello 你好 world')).toBe('zh')
  })

  it('returns "en" for empty / null / undefined', () => {
    expect(detectCustomerLocale('')).toBe('en')
    expect(detectCustomerLocale(null)).toBe('en')
    expect(detectCustomerLocale(undefined)).toBe('en')
  })
})

describe('escalationMessageFor', () => {
  it('returns the English template for English input', () => {
    expect(escalationMessageFor('I need help')).toBe(ESCALATION_TO_HUMAN.en)
  })

  it('returns the Chinese template for Chinese input', () => {
    expect(escalationMessageFor('我需要帮助')).toBe(ESCALATION_TO_HUMAN.zh)
  })

  it('regression: English input must NOT return the Chinese constant', () => {
    expect(escalationMessageFor('I need help')).not.toBe(ESCALATION_TO_HUMAN.zh)
  })
})

describe('source regression: no hardcoded Mandarin escalation literal', () => {
  const RAW = '非常抱歉，您的问题需要由人工专员'

  it('loop.ts no longer contains the raw Mandarin escalation literal', () => {
    const src = readFileSync(join(__dirname, '..', 'loop.ts'), 'utf8')
    expect(src).not.toContain(RAW)
  })

  it('tool-interceptor.ts no longer contains the raw Mandarin escalation literal', () => {
    const src = readFileSync(join(__dirname, '..', 'tool-interceptor.ts'), 'utf8')
    expect(src).not.toContain(RAW)
  })
})
