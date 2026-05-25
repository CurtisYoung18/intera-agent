// Console auth utilities — simple cookie-based customer identity

import { cookies } from 'next/headers'
import { prisma } from '@intera/shared/prisma'

const COOKIE_CUSTOMER_ID = 'intera_customer_id'
const COOKIE_AUTHED = 'intera_auth'

export async function getActiveCustomerId(): Promise<string> {
  try {
    const cookieStore = await cookies()
    const customerId = cookieStore.get(COOKIE_CUSTOMER_ID)?.value
    if (!customerId) return 'default'

    const customer = await prisma.customer.findUnique({ where: { id: customerId } })
    return customer ? customerId : 'default'
  } catch {
    return 'default'
  }
}

export async function getActiveCustomer(): Promise<{
  id: string
  name: string
  hasPassword: boolean
  isAuthed: boolean
} | null> {
  try {
    const cookieStore = await cookies()
    const customerId = cookieStore.get(COOKIE_CUSTOMER_ID)?.value
    const authed = cookieStore.get(COOKIE_AUTHED)?.value === '1'

    if (!customerId) {
      return { id: 'default', name: 'Demo Vendor', hasPassword: false, isAuthed: false }
    }

    const customer = await prisma.customer.findUnique({ where: { id: customerId } })
    if (!customer) {
      return { id: 'default', name: 'Demo Vendor', hasPassword: false, isAuthed: false }
    }

    return {
      id: customer.id,
      name: customer.name,
      hasPassword: customer.password != null,
      isAuthed: authed,
    }
  } catch {
    return null
  }
}
