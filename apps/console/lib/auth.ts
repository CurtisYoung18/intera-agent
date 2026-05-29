// Console auth utilities — simple cookie-based customer identity

import { cookies } from 'next/headers'
import { prisma } from '@intera/shared/prisma'

const COOKIE_VENDOR_ID = 'intera_vendor_id'
const COOKIE_AUTHED = 'intera_auth'

export async function getActiveVendorId(): Promise<string> {
  try {
    const cookieStore = await cookies()
    const vendorId = cookieStore.get(COOKIE_VENDOR_ID)?.value
    if (!vendorId) return 'default'

    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } })
    return vendor ? vendorId : 'default'
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
    const vendorId = cookieStore.get(COOKIE_VENDOR_ID)?.value
    const authed = cookieStore.get(COOKIE_AUTHED)?.value === '1'

    if (!vendorId) {
      return { id: 'default', name: 'Demo Vendor', hasPassword: false, isAuthed: false }
    }

    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } })
    if (!vendor) {
      return { id: 'default', name: 'Demo Vendor', hasPassword: false, isAuthed: false }
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
