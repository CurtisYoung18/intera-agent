// Console auth utilities — now backed by a SIGNED session (lib/session.ts).
//
// SECURITY: the old plaintext `intera_org_id` / `intera_auth` cookies are NO LONGER
// trusted. orgId is read ONLY from a verified HMAC session token, so a client cannot
// forge it to access another tenant's data.

import { cookies } from 'next/headers'
import { prisma } from '@intera/shared/prisma'
import { SESSION_COOKIE, verifySessionToken, type SessionRole } from '@/lib/session'

export interface ActiveSession {
  orgId: string
  role: SessionRole
}

/** Read + verify the current session. Returns null if no valid session. */
export async function getSession(): Promise<ActiveSession | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(SESSION_COOKIE)?.value
    const payload = await verifySessionToken(token)
    if (!payload) return null
    return { orgId: payload.orgId, role: payload.role }
  } catch {
    return null
  }
}

/**
 * Active org id from the VERIFIED session. Returns '' when there is no valid
 * session — callers querying `where: { orgId: '' }` get empty results (fail
 * closed; never another tenant's data). Gated routes are blocked earlier by
 * middleware, so this only returns '' on unauthenticated dual-auth paths.
 */
export async function getActiveOrgId(): Promise<string> {
  const session = await getSession()
  return session?.orgId ?? ''
}

export async function getActiveVendor(): Promise<{
  id: string
  name: string
  hasPassword: boolean
  isAuthed: boolean
  role: SessionRole | null
} | null> {
  try {
    const session = await getSession()
    if (!session) {
      return { id: '', name: '', hasPassword: false, isAuthed: false, role: null }
    }
    const org = await prisma.organization.findUnique({ where: { id: session.orgId } })
    if (!org) {
      return { id: '', name: '', hasPassword: false, isAuthed: false, role: null }
    }
    return {
      id: org.id,
      name: org.name,
      hasPassword: org.password != null,
      isAuthed: true,
      role: session.role,
    }
  } catch {
    return null
  }
}
