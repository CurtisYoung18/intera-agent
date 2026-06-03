import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export const INTERNAL_SECRET_HEADER = 'x-intera-internal'

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

/** 生成新 key：返回明文（只此一次可见）+ 要落库的 hash/prefix。 */
export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const raw = `intera_sk_live_${randomBytes(32).toString('base64url')}`
  return { plaintext: raw, hash: sha256(raw), prefix: raw.slice(0, 20) }
}

/** 从请求解析出已鉴权 orgId + agentConfigId；失败返回 null（调用方负责回 401）。 */
export async function resolveOrgFromApiKey(req: NextRequest): Promise<{
  orgId: string
  agentConfigId: string | null
} | null> {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const key = auth.slice(7).trim()
  if (!key) return null

  const hash = sha256(key)
  const rec = await prisma.apiKey.findUnique({ where: { hash } })
  if (!rec || rec.revokedAt) return null

  // Update lastUsedAt (fire-and-forget, don't block auth)
  prisma.apiKey.update({ where: { hash }, data: { lastUsedAt: new Date() } }).catch(() => {})

  return { orgId: rec.orgId, agentConfigId: rec.agentConfigId }
}

/** 内部服务自调用（bridge → /api/messages 进程内或本地 HTTP 时用）。 */
export function isTrustedInternalCall(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret) return false
  const headerValue = req.headers.get(INTERNAL_SECRET_HEADER)
  if (!headerValue) return false

  const a = Buffer.from(secret)
  const b = Buffer.from(headerValue)
  if (a.length !== b.length) {
    // Compare against self so timing doesn't leak the expected length.
    timingSafeEqual(a, a)
    return false
  }
  return timingSafeEqual(a, b)
}
