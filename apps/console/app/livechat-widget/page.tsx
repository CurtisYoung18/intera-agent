import LiveChatFormWidget from '@/components/livechat/livechat-form-widget'
import {
  detectWidgetLocale,
  getWidgetCopy,
  isWidgetPreview,
  parseWidgetFields,
  readWidgetSearchParam,
} from '@/lib/livechat/form-widget'

export const dynamic = 'force-dynamic'

export default async function LiveChatWidgetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const fields = parseWidgetFields(params.fields)
  const locale = detectWidgetLocale({
    title: readWidgetSearchParam(params, 'title'),
    description: readWidgetSearchParam(params, 'description'),
    fields,
  })
  const copy = getWidgetCopy(locale)

  const title = readWidgetSearchParam(params, 'title') || copy.fallbackTitle
  const description = readWidgetSearchParam(params, 'description') || copy.fallbackDescription
  const caseId = readWidgetSearchParam(params, 'caseId') || undefined
  const chatId = readWidgetSearchParam(params, 'chatId') || undefined
  const orgId = readWidgetSearchParam(params, 'orgId') || undefined
  const agentConfigId = readWidgetSearchParam(params, 'agentConfigId') || readWidgetSearchParam(params, 'agentId') || undefined
  const preview = isWidgetPreview(params)

  return (
    <LiveChatFormWidget
      title={title}
      description={description}
      fields={fields}
      caseId={caseId}
      chatId={chatId}
      orgId={orgId}
      agentConfigId={agentConfigId}
      preview={preview}
      locale={locale}
    />
  )
}
