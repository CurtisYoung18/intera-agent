import { describe, it, expect } from 'vitest'
import { resolveEffectiveModel } from '../resolve-model'
import { DEFAULT_MODEL } from '@intera/shared/defaults'

describe('resolveEffectiveModel', () => {
  it('returns DEFAULT_MODEL when config.model is an empty string', () => {
    expect(resolveEffectiveModel({ model: '' })).toBe(DEFAULT_MODEL)
  })

  it('returns DEFAULT_MODEL when config.model is null', () => {
    expect(resolveEffectiveModel({ model: null })).toBe(DEFAULT_MODEL)
  })

  it('returns DEFAULT_MODEL when config.model is undefined', () => {
    expect(resolveEffectiveModel({ model: undefined })).toBe(DEFAULT_MODEL)
  })

  it('returns DEFAULT_MODEL when config.model is not present', () => {
    expect(resolveEffectiveModel({})).toBe(DEFAULT_MODEL)
  })

  it('returns the explicit model when config.model is set', () => {
    expect(resolveEffectiveModel({ model: 'claude-sonnet-4-20250514' })).toBe('claude-sonnet-4-20250514')
  })

  it('returns the explicit model when set to a different value', () => {
    expect(resolveEffectiveModel({ model: 'deepseek-v4-pro' })).toBe('deepseek-v4-pro')
  })
})
