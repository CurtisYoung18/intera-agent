// Tenant isolation seam (G2 app-layer).
//
// Every route handler receives a repoForOrg(orgId) instance. All org-scoped
// models auto-inject `orgId` into where / data, so handler code cannot
// accidentally query or mutate another tenant's rows.
//
// Raw `prisma.*` access in route/handler code is forbidden once a route is
// migrated — use the repo instead.
//
// SAFETY: the Proxy fall-through THROWS for any method not explicitly wrapped,
// so a new Prisma method (or a typo) cannot silently bypass tenant scoping.

import { prisma } from '@intera/shared/prisma'

// ── Helpers ──

function whereHasOrgId(where: any): boolean {
  if (!where) return false
  if (where.orgId !== undefined) return true
  for (const key of Object.keys(where)) {
    if (key.startsWith('orgId_') && where[key]?.orgId !== undefined) return true
  }
  return false
}

// ── Scoped model accessor ──

export function scopedModel<T extends Record<string, any>>(
  model: T,
  orgId: string,
): T {
  const injectWhere = (args: any) => {
    if (!args) return { where: { orgId } }
    return { ...args, where: { ...(args.where ?? {}), orgId } }
  }
  const injectData = (args: any) => {
    if (!args) return { data: { orgId } }
    return { ...args, data: { ...(args.data ?? {}), orgId } }
  }

  const WHERE_INJECT = new Set([
    'findMany', 'findFirst', 'findFirstOrThrow', 'count',
    'updateMany', 'deleteMany',
  ])
  const WHERE_INJECT_PRESERVE = new Set([
    'findUnique', 'findUniqueOrThrow', 'update', 'delete',
  ])
  const DATA_INJECT = new Set(['create'])
  const DATA_INJECT_MANY = new Set(['createMany'])
  const UPSERT = new Set(['upsert'])

  return new Proxy(model, {
    get(_target, prop: string) {
      const original = (model as any)[prop]

      if (original === undefined) {
        return () => {
          throw new Error(
            `repoForOrg: "${prop}" is not org-scoped. Wrap it explicitly or use repo.raw.`,
          )
        }
      }

      if (typeof original !== 'function') {
        return original
      }

      // Use method-form so `this` binds on the real Prisma delegate.
      const call = (args: any) => (model as any)[prop](args)

      if (WHERE_INJECT.has(prop)) {
        return (args?: any) => call(injectWhere(args))
      }
      if (WHERE_INJECT_PRESERVE.has(prop)) {
        return (args: any) => {
          if (whereHasOrgId(args?.where)) return call(args)
          return call(injectWhere(args))
        }
      }
      if (DATA_INJECT.has(prop)) {
        return (args: any) => call(injectData(args))
      }
      if (DATA_INJECT_MANY.has(prop)) {
        return (args: any) => {
          if (!args) return call({ data: (args as any)?.data?.map?.((d: any) => ({ ...d, orgId })) ?? [] })
          const injected = Array.isArray(args.data)
            ? args.data.map((d: any) => ({ ...d, orgId }))
            : [{ ...args.data, orgId }]
          return call({ ...args, data: injected })
        }
      }
      if (UPSERT.has(prop)) {
        return (args: any) => {
          const safeArgs = whereHasOrgId(args?.where)
            ? args
            : { ...args, where: { ...(args.where ?? {}), orgId } }
          return call({
            ...safeArgs,
            create: { ...(safeArgs.create ?? {}), orgId },
            update: { ...(safeArgs.update ?? {}) },
          })
        }
      }

      return () => {
        throw new Error(
          `repoForOrg: "${prop}" is not org-scoped. Wrap it explicitly or use repo.raw.`,
        )
      }
    },
  }) as T
}

// ── Org-scoped repo ──

export function repoForOrg(orgId: string) {
  return {
    orgId,
    skill: scopedModel(prisma.skill, orgId),
    agentConfig: scopedModel(prisma.agentConfig, orgId),
    caseType: scopedModel(prisma.caseType, orgId),
    policy: scopedModel(prisma.policy, orgId),
    knowledgeSource: scopedModel(prisma.knowledgeSource, orgId),
    apiKey: scopedModel(prisma.apiKey, orgId),
    case: scopedModel(prisma.case, orgId),
    userProfile: scopedModel(prisma.userProfile, orgId),
    liveChatConfig: scopedModel(prisma.liveChatConfig, orgId),
    livechatPendingEvent: scopedModel(prisma.liveChatPendingEvent, orgId),
    channelHealth: scopedModel(prisma.channelHealth, orgId),
    chatSession: scopedModel(prisma.chatSession, orgId),
    channelBinding: scopedModel(prisma.channelBinding, orgId),
    externalConversation: scopedModel(prisma.externalConversation, orgId),
    membership: scopedModel(prisma.membership, orgId),
    invitation: scopedModel(prisma.invitation, orgId),
    auditLog: scopedModel(prisma.auditLog, orgId),
    raw: prisma,
  }
}

export type RepoForOrg = ReturnType<typeof repoForOrg>
