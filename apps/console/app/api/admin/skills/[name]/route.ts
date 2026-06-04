// GET + PUT + DELETE /api/admin/skills/[name]
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping + G3 RBAC + audit).

import { defineRoute, ForbiddenError, NotFoundError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  skillUpdateRequestSchema,
  type SkillUpdateRequest,
} from '@intera/shared/contracts/skills'
import { SYSTEM_SKILL_NAMES, SPECIAL_SKILL_NAMES, CHANNEL_SKILL_NAMES } from '@/lib/skill-classifications'

// ── Route params ──
interface SkillParams {
  name: string
}

function isProtected(name: string): boolean {
  return SYSTEM_SKILL_NAMES.has(name) || SPECIAL_SKILL_NAMES.has(name) || CHANNEL_SKILL_NAMES.has(name)
}

function isMutationAllowed(name: string, body: Record<string, unknown>): boolean {
  if (!isProtected(name)) return true
  const keys = Object.keys(body).filter((k) => k !== 'enabled')
  return keys.length === 0
}

// ── GET ──
export const GET = defineRoute<void, SkillParams>({
  method: 'GET',
  async handler({ params, repo }) {
    const skill = await repo.skill.findUnique({
      where: { orgId_name: { orgId: repo.orgId, name: params.name } },
    })
    if (!skill) throw new NotFoundError(`Skill "${params.name}" not found`)
    return apiOk({ skill })
  },
})

// ── PUT ──
export const PUT = defineRoute<SkillUpdateRequest, SkillParams>({
  method: 'PUT',
  inputSchema: skillUpdateRequestSchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, params, session, repo, audit }) {
    const existing = await repo.skill.findUnique({
      where: { orgId_name: { orgId: repo.orgId, name: params.name } },
    })
    if (!existing) throw new NotFoundError(`Skill "${params.name}" not found`)

    if (!isMutationAllowed(params.name, input as Record<string, unknown>)) {
      throw new ForbiddenError(
        `Skill "${params.name}" is protected. Only the 'enabled' field can be changed.`,
      )
    }

    const stringifyField = (val: unknown): string | undefined | null => {
      if (val === undefined) return undefined
      if (val === null) return null
      return typeof val === 'string' ? val : JSON.stringify(val)
    }

    const data: Record<string, unknown> = {}
    const strFields = ['name', 'description', 'mode', 'endpoint', 'httpMethod', 'guardPhase', 'toolCategory']
    for (const f of strFields) {
      const v = (input as Record<string, unknown>)[f]
      if (v !== undefined) data[f] = v
    }
    if (input.timeoutMs !== undefined) data.timeoutMs = input.timeoutMs
    if (input.isConcurrencySafe !== undefined) data.isConcurrencySafe = input.isConcurrencySafe
    if (input.enabled !== undefined) data.enabled = input.enabled
    for (const f of ['inputSchema', 'outputSchema', 'headers', 'mockFixture', 'displayVerb', 'renderHints']) {
      const v = (input as Record<string, unknown>)[f]
      if (v !== undefined) data[f] = stringifyField(v)
    }

    const skill = await repo.skill.update({
      where: { orgId_name: { orgId: repo.orgId, name: params.name } },
      data,
    })

    await audit({ action: 'skill.update', target: `skill:${skill.name}`, before: existing as Record<string, unknown>, after: skill as Record<string, unknown> })

    return apiOk({ skill })
  },
})

// ── DELETE ──
export const DELETE = defineRoute<void, SkillParams>({
  method: 'DELETE',
  requireRole: ['admin', 'owner'],
  async handler({ params, session, repo, audit }) {
    if (isProtected(params.name)) {
      throw new ForbiddenError(`Cannot delete protected skill "${params.name}"`)
    }
    const existing = await repo.skill.findUnique({
      where: { orgId_name: { orgId: repo.orgId, name: params.name } },
    })
    if (!existing) throw new NotFoundError(`Skill "${params.name}" not found`)

    await repo.skill.delete({
      where: { orgId_name: { orgId: repo.orgId, name: params.name } },
    })

    await audit({ action: 'skill.delete', target: `skill:${params.name}`, before: existing as Record<string, unknown> })

    return apiOk({ success: true })
  },
})
