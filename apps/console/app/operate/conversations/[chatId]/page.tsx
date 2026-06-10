import ConversationDetailWorkspace from '@/components/operate/conversation-detail-workspace'

export default async function OperateConversationDetailPage({
  params,
}: {
  params: Promise<{ chatId: string }>
}) {
  const { chatId } = await params
  return <ConversationDetailWorkspace chatId={chatId} />
}
