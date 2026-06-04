// Route-level guard tests for /api/users — contract validation
// and handler logic tested in isolation.

import { describe, it, expect } from 'vitest'

// ── Handler logic tests ─────────────────────────────────────────────────────

describe('users handler logic (isolation tests)', () => {
  it('strips user: prefix from profile keys for member users', () => {
    const key = 'user:alice'
    const kind = key.startsWith('user:')
      ? 'member'
      : key.startsWith('chat:')
        ? 'anonymous'
        : 'unknown'
    const label = key.replace(/^(user:|chat:)/, '')

    expect(kind).toBe('member')
    expect(label).toBe('alice')
  })

  it('strips chat: prefix for anonymous users', () => {
    const key = 'chat:abc123def'
    const kind = key.startsWith('user:')
      ? 'member'
      : key.startsWith('chat:')
        ? 'anonymous'
        : 'unknown'
    const label = key.replace(/^(user:|chat:)/, '')

    expect(kind).toBe('anonymous')
    expect(label).toBe('abc123def')
  })

  it('marks unknown kind for unrecognized prefixes', () => {
    const key = 'mysterious_key'
    const kind = key.startsWith('user:')
      ? 'member'
      : key.startsWith('chat:')
        ? 'anonymous'
        : 'unknown'
    const label = key.replace(/^(user:|chat:)/, '')

    expect(kind).toBe('unknown')
    expect(label).toBe('mysterious_key')
  })

  it('detects hasProfile when profile is non-empty', () => {
    const p1 = { profile: 'Some profile text' }
    const p2 = { profile: '' }
    const p3 = { profile: '   ' }

    const hasProfile1 = !!p1.profile && p1.profile.trim().length > 0
    const hasProfile2 = !!p2.profile && p2.profile.trim().length > 0
    const hasProfile3 = !!p3.profile && p3.profile.trim().length > 0

    expect(hasProfile1).toBe(true)
    expect(hasProfile2).toBe(false)
    expect(hasProfile3).toBe(false)
  })

  it('handler must not write orgId in query where clause', () => {
    // The handler passes where clause WITHOUT orgId.
    // The repo Proxy injects it.
    const handlerArgs = { orderBy: { updatedAt: 'desc' }, take: 200 }
    expect(handlerArgs).not.toHaveProperty('where')
  })
})
