import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  caseTypes: [] as Array<{ type: string; displayName: string; description?: string | null }>,
  hookBindings: [] as Array<{
    hook: { name: string; checkpoint: string; description?: string | null } | null
  }>,
}))

vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    caseType: {
      findMany: vi.fn(async () => h.caseTypes),
    },
    hookBinding: {
      findMany: vi.fn(async () => h.hookBindings),
    },
  },
}))

import { prisma } from '@intera/shared/prisma'
import { buildPromptContext, resolvePrompt } from '@/lib/agent/prompt-resolver'
import { isOpaqueInternalUserId, isVerifiedMemberId, profileKey } from '@/lib/agent/identity'

describe('buildPromptContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.caseTypes = []
    h.hookBindings = []
  })

  it('only surfaces hooks that have enabled bindings and deduplicates repeated bindings', async () => {
    h.caseTypes = [
      { type: 'deposit_issue', displayName: 'Deposit issue', description: 'Handle deposit failures' },
    ]
    h.hookBindings = [
      { hook: { name: 'zeta_stop_hook', checkpoint: 'Stop', description: 'Stop rule' } },
      { hook: { name: 'alpha_pretool_hook', checkpoint: 'PreToolUse', description: 'PreTool rule' } },
      { hook: { name: 'zeta_stop_hook', checkpoint: 'Stop', description: 'Stop rule' } },
      { hook: null },
    ]

    const ctx = await buildPromptContext({ agentConfigId: 'agent_test' })

    expect(prisma.hookBinding.findMany).toHaveBeenCalledWith({
      where: {
        agentConfigId: 'agent_test',
        enabled: true,
        hook: { enabled: true },
      },
      distinct: ['hookId'],
      select: {
        hook: {
          select: { name: true, checkpoint: true, description: true },
        },
      },
    })
    expect(ctx.case_types).toEqual([
      { type: 'deposit_issue', displayName: 'Deposit issue', description: 'Handle deposit failures' },
    ])
    expect(ctx.active_hooks).toEqual([
      { name: 'alpha_pretool_hook', checkpoint: 'PreToolUse', description: 'PreTool rule' },
      { name: 'zeta_stop_hook', checkpoint: 'Stop', description: 'Stop rule' },
    ])
  })
})

describe('session binding identity handling', () => {
  it('does not treat opaque internal ids as verified member ids', () => {
    expect(isOpaqueInternalUserId('cmpzcj5ei000nqjb18ils6otp')).toBe(true)
    expect(isVerifiedMemberId('cmpzcj5ei000nqjb18ils6otp')).toBe(false)
    expect(profileKey('cmpzcj5ei000nqjb18ils6otp', 'pg_chat_1')).toBe('chat:pg_chat_1')

    const rendered = resolvePrompt('{{session_binding}}', {
      session_binding: { userId: 'cmpzcj5ei000nqjb18ils6otp', userLabel: 'Playground Admin' },
    })
    expect(rendered).toContain('## Current User')
    expect(rendered).toContain('Session ID')
    expect(rendered).toContain('member_id: 未知 / unknown')
    expect(rendered).not.toContain('Member ID: `cmpzcj5ei000nqjb18ils6otp` (verified)')
  })

  it('still marks platform member ids as verified when they match the business pattern', () => {
    expect(isOpaqueInternalUserId('JAYA113C88F')).toBe(false)
    expect(isVerifiedMemberId('JAYA113C88F')).toBe(true)
    expect(profileKey('JAYA113C88F', 'pg_chat_2')).toBe('user:JAYA113C88F')

    const rendered = resolvePrompt('{{session_binding}}', {
      session_binding: { userId: 'JAYA113C88F', userLabel: 'Known Member' },
    })
    expect(rendered).toContain('Member ID: `JAYA113C88F` (verified)')
    expect(rendered).not.toContain('member_id: 未知 / unknown')
  })
})

describe('available tools rendering', () => {
  it('groups knowledge tools by structured identity instead of relying on kb_search_ prefixes', () => {
    const rendered = resolvePrompt('{{available_tools}}', {
      available_tools: [
        {
          name: 'faq_lookup_default',
          description: 'Search the FAQ knowledge base',
          needsMemberId: false,
          knowledgeSourceId: 'ks_faq',
        },
        {
          name: 'get_latest_deposit',
          description: 'Fetch the latest deposit',
          needsMemberId: true,
        },
        {
          name: 'create_human_task',
          description: 'Request human help',
          needsMemberId: false,
        },
      ],
    })

    expect(rendered).toContain('## Available Tools')
    expect(rendered).toContain('**Knowledge Bases**')
    expect(rendered).toContain('faq_lookup_default: Search the FAQ knowledge base')
    expect(rendered).toContain('**Account Lookups**')
    expect(rendered).toContain('get_latest_deposit: Fetch the latest deposit')
    expect(rendered).toContain('**Actions**')
    expect(rendered).toContain('create_human_task: Request human help')
  })
})
