// Console auth utilities — simple cookie-based customer identity

import { cookies } from 'next/headers'
import { prisma } from '@intera/shared/prisma'

const COOKIE_ORG_ID = 'intera_org_id'
const COOKIE_AUTHED = 'intera_auth'

export async function getActiveOrgId(): Promise<string> {
  try {
    const cookieStore = await cookies()
    const orgId = cookieStore.get(COOKIE_ORG_ID)?.value
    if (!orgId) return 'default'

    const vendor = await prisma.organization.findUnique({ where: { id: orgId } })
    return vendor ? orgId : 'default'
  } catch {
    return 'default'
  }
}

export async function getActiveVendor(): Promise<{
  id: string
  name: string
  hasPassword: boolean
  isAuthed: boolean
} | null> {
  try {
    const cookieStore = await cookies()
    const orgId = cookieStore.get(COOKIE_ORG_ID)?.value
    const authed = cookieStore.get(COOKIE_AUTHED)?.value === '1'

    if (!orgId) {
      return { id: 'default', name: 'Demo Org', hasPassword: false, isAuthed: false }
    }

    const vendor = await prisma.organization.findUnique({ where: { id: orgId } })
    if (!vendor) {
      return { id: 'default', name: 'Demo Org', hasPassword: false, isAuthed: false }
    }

    return {
      id: vendor.id,
      name: vendor.name,
      hasPassword: vendor.password != null,
      isAuthed: authed,
    }
  } catch {
    return null
  }
}
