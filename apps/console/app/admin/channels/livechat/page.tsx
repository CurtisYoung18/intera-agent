import { redirectWithSearch } from '@/app/_lib/legacy-redirect'

export default async function AdminLiveChatRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return redirectWithSearch('/build/components/integrations?tab=channels&channel=livechat', searchParams)
}
