import { redirectWithSearch } from '@/app/_lib/legacy-redirect'

export default async function AdminKnowledgeRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  return redirectWithSearch('/build/components/knowledge', searchParams)
}
