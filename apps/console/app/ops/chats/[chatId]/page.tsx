import { redirectWithSearch } from '@/app/_lib/legacy-redirect'

export default async function OpsChatDetailRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ chatId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { chatId } = await params
  return redirectWithSearch(`/operate/conversations/${encodeURIComponent(chatId)}`, searchParams)
}
