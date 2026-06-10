import { redirect } from 'next/navigation'

export default function AdminOrganizationRedirectPage() {
  redirect('/settings/organization')
}
