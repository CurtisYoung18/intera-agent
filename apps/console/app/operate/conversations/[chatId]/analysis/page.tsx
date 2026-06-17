import ConversationAnalysisWorkspace from '@/components/operate/conversation-analysis-workspace'

export default async function OperateConversationAnalysisPage({
  params,
}: {
  params: Promise<{ chatId: string }>
}) {
  const { chatId } = await params
  return <ConversationAnalysisWorkspace chatId={chatId} />
}
