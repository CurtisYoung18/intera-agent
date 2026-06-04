// GET + POST /api/admin/skills — List and create skills
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping + G3 RBAC + audit).

import { defineRoute } from '@/lib/api/define-route'
import { apiOk, apiCreated } from '@intera/shared/contracts/envelope'
import {
  skillCreateRequestSchema,
  type SkillCreateRequest,
} from '@intera/shared/contracts/skills'
import { DEFAULT_SKILLS } from '@intera/shared/defaults'
import { SYSTEM_SKILL_NAMES, SPECIAL_SKILL_NAMES, CHANNEL_SKILL_NAMES } from '@/lib/skill-classifications'

// ── GET ──
export const GET = defineRoute({
  method: 'GET',
  async handler({ session, repo }) {
    let skills = await repo.skill.findMany({ orderBy: { name: 'asc' } })

    const requiredNames = new Set([...SYSTEM_SKILL_NAMES, ...SPECIAL_SKILL_NAMES])
    const existingNames = new Set(skills.map((s: { name: string }) => s.name))
    const toUpsert = DEFAULT_SKILLS.filter(
      (s) => requiredNames.has(s.name) && !existingNames.has(s.name),
    )

    if (skills.length === 0 || toUpsert.length > 0) {
      await repo.raw.organization.upsert({
        where: { id: session.orgId },
        update: {},
        create: { id: session.orgId, name: 'Demo Org' },
      })
      const namesToSeed = skills.length === 0 ? DEFAULT_SKILLS : toUpsert
      for (const s of namesToSeed) {
        await repo.skill.upsert({
          where: { orgId_name: { orgId: session.orgId, name: s.name } },
          update: {
            description: s.description, inputSchema: s.inputSchema, outputSchema: s.outputSchema,
            mode: s.mode, isConcurrencySafe: s.isConcurrencySafe, enabled: s.enabled,
            guardPhase: s.guardPhase, endpoint: s.endpoint ?? null, httpMethod: s.httpMethod ?? 'POST',
            headers: s.headers ?? null, timeoutMs: s.timeoutMs ?? 8000,
            mockFixture: s.mockFixture ?? null,
            displayVerb: s.displayVerb ? JSON.stringify(s.displayVerb) : null,
            toolCategory: s.toolCategory ?? null,
          },
          create: {
            orgId: session.orgId, name: s.name, description: s.description,
            inputSchema: s.inputSchema, outputSchema: s.outputSchema, mode: s.mode,
            isConcurrencySafe: s.isConcurrencySafe, enabled: s.enabled, guardPhase: s.guardPhase,
            endpoint: s.endpoint ?? null, httpMethod: s.httpMethod ?? 'POST',
            headers: s.headers ?? null, timeoutMs: s.timeoutMs ?? 8000,
            mockFixture: s.mockFixture ?? null,
            displayVerb: s.displayVerb ? JSON.stringify(s.displayVerb) : null,
            toolCategory: s.toolCategory ?? null,
          },
        })
      }
      skills = await repo.skill.findMany({ orderBy: { name: 'asc' } })
    }

    const enriched = skills.map((s: { name: string; [k: string]: unknown }) => ({
      ...s,
      isSystem: SYSTEM_SKILL_NAMES.has(s.name),
      isChannel: CHANNEL_SKILL_NAMES.has(s.name),
      isSpecial: SPECIAL_SKILL_NAMES.has(s.name),
    }))

    return apiOk({ skills: enriched })
  },
})

// ── POST ──
export const POST = defineRoute<SkillCreateRequest>({
  method: 'POST',
  inputSchema: skillCreateRequestSchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, session, repo, audit }) {
    await repo.raw.organization.upsert({
      where: { id: session.orgId },
      update: {},
      create: { id: session.orgId, name: 'Demo Org' },
    })

    const stringifyField = (val: unknown): string | null => {
      if (val === null || val === undefined) return null
      return typeof val === 'string' ? val : JSON.stringify(val)
    }

    const skill = await repo.skill.create({
      data: {
        name: input.name,
        description: input.description ?? '',
        inputSchema: stringifyField(input.inputSchema) ?? '{}',
        outputSchema: stringifyField(input.outputSchema) ?? '{}',
        mode: input.mode ?? 'mock',
        endpoint: input.endpoint ?? null,
        httpMethod: input.httpMethod ?? 'POST',
        headers: stringifyField(input.headers),
        timeoutMs: input.timeoutMs ?? 8000,
        mockFixture: stringifyField(input.mockFixture),
        guardPhase: input.guardPhase ?? 'post',
        displayVerb: stringifyField(input.displayVerb),
        renderHints: stringifyField(input.renderHints),
        isConcurrencySafe: input.isConcurrencySafe ?? true,
        enabled: input.enabled ?? true,
        toolCategory: input.toolCategory ?? null,
      },
    })

    await audit({ action: 'skill.create', target: `skill:${skill.name}`, after: skill as Record<string, unknown> })

    return apiCreated({ skill })
  },
})
