import { redirect } from 'next/navigation'

export default function GuardrailsRedirectPage() {
  redirect('/admin/hooks')
}
