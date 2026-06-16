import { redirectWithSearch } from '@/app/_lib/legacy-redirect'

export default async function GuardrailsRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  return redirectWithSearch('/build/components/hooks', searchParams)
}
