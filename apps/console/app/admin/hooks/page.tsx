import { redirectWithSearch } from '@/app/_lib/legacy-redirect'

export default async function AdminHooksRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  return redirectWithSearch('/build/components/hooks', searchParams)
}
