import { describe, it, expect } from 'vitest'
import { shouldSkipEvent } from '../../webhook-filter'

const AGENT_ID = 'agent@example.com'

describe('shouldSkipEvent', () => {
  it('returns skip=false when no agentAccountId configured', () => {
    expect(shouldSkipEvent({ authorId: 'visitor', presentIds: [] })).toEqual({ skip: false })
  })

  it('returns skip=true with self_authored when author is our agent', () => {
    expect(shouldSkipEvent({ agentAccountId: AGENT_ID, authorId: AGENT_ID, presentIds: [AGENT_ID] }))
      .toEqual({ skip: true, reason: 'self_authored' })
  })

  it('returns skip=true with not_my_chat when agent not in presentIds', () => {
    expect(shouldSkipEvent({ agentAccountId: AGENT_ID, authorId: 'visitor', presentIds: ['other@agent.com'] }))
      .toEqual({ skip: true, reason: 'not_my_chat' })
  })

  it('returns skip=false when agent is in presentIds and author is visitor', () => {
    expect(shouldSkipEvent({ agentAccountId: AGENT_ID, authorId: 'visitor', presentIds: [AGENT_ID] }))
      .toEqual({ skip: false })
  })

  it('returns skip=false when presentIds is empty (no presence data available)', () => {
    expect(shouldSkipEvent({ agentAccountId: AGENT_ID, authorId: 'visitor', presentIds: [] }))
      .toEqual({ skip: false })
  })

  it('self_authored takes priority over not_my_chat', () => {
    expect(shouldSkipEvent({ agentAccountId: AGENT_ID, authorId: AGENT_ID, presentIds: ['other@agent.com'] }))
      .toEqual({ skip: true, reason: 'self_authored' })
  })
})
