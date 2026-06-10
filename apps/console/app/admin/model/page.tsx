import { redirectWithSearch } from '@/app/_lib/legacy-redirect'

export default async function AdminModelRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return redirectWithSearch('/build/components/brain?mode=model', searchParams)
}
