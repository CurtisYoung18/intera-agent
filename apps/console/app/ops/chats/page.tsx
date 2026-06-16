import { redirectWithSearch } from '@/app/_lib/legacy-redirect'

export default async function OpsChatsRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  return redirectWithSearch('/operate/conversations', searchParams)
}
