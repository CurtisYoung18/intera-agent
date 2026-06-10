import { describe, expect, it } from 'vitest'
import { mapLegacyRoute } from './middleware'

describe('mapLegacyRoute', () => {
  const cases: Array<[string, string | null]> = [
    ['/', null],
    ['/admin', '/build/pilot-lab'],
    ['/admin/', '/build/pilot-lab'],
    ['/admin/playground', '/build/pilot-lab'],
    ['/admin/model', '/build/components/brain?mode=model'],
    ['/admin/memory', '/build/components/brain?mode=memory'],
    ['/admin/guardrails', '/build/components/hooks'],
    ['/admin/case-types', '/build/components/procedures'],
    ['/admin/case-types/foo', '/build/components/procedures/foo'],
    ['/admin/tools/', '/build/components/tools'],
    ['/admin/tools', '/build/components/tools'],
    ['/admin/knowledge/', '/build/components/knowledge'],
    ['/admin/knowledge', '/build/components/knowledge'],
    ['/admin/integrations/', '/build/components/integrations'],
    ['/admin/integrations', '/build/components/integrations'],
    ['/admin/channels', '/build/components/integrations'],
    ['/admin/channels/web-chat', '/build/components/integrations'],
    ['/admin/channels/web-chat/', '/build/components/integrations'],
    ['/admin/organization', '/settings/organization'],
    ['/admin/organization/', '/settings/organization'],
    ['/admin/scenarios', '/build/pilot-lab'],
    ['/admin/scenarios/', '/build/pilot-lab'],
    ['/ops', '/operate/conversations'],
    ['/ops/', '/operate/conversations'],
    ['/ops/chats', '/operate/conversations'],
    ['/ops/chats/', '/operate/conversations'],
    ['/ops/chats/abc', '/operate/conversations/abc'],
    ['/ops/chats/abc/', '/operate/conversations/abc'],
    ['/ops/cases/abc', '/operate/conversations/cases/abc'],
    ['/ops/cases/abc/', '/operate/conversations/cases/abc'],
    ['/ops/users', '/operate/handoff'],
    ['/ops/users/', '/operate/handoff'],
    ['/ops/users/u1', '/operate/handoff/u1'],
    ['/ops/users/u1/', '/operate/handoff/u1'],
    ['/ops/dashboards', '/operate/handoff'],
    ['/ops/guide', '/build/pilot-lab'],
    ['/ops/guide/', '/build/pilot-lab'],
    ['/build/release', null],
    ['/some/other/path', null],
  ]

  it('maps legacy routes to U1 targets', () => {
    for (const [input, expected] of cases) {
      expect(mapLegacyRoute(input)).toBe(expected)
    }
  })
})
