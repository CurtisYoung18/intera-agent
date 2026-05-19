'use client'

// Intera Harness — Chat Page
// Left case panel (stacked cards) + chat panel. No floating overlays.

import ChatShell from '@/components/chat/chat-shell'
import StatusPill from '@intera/shared/ui/status-pill'
import MessageList from '@/components/chat/message-list'
import VoiceInputBar from '@/components/chat/voice-input-bar'
import WelcomeMessage from '@/components/chat/welcome-message'
import CasePanel from '@/components/chat/case-panel'
import SplitLayout from '@/components/chat/split-layout'
import CaseTabBar from '@/components/chat/case-tab-bar'
import CaseHistoryPanel from '@/components/chat/case-history-panel'
import { useInteraChat } from './use-intera-chat'

export default function ChatPage() {
  const {
    messages,
    agentStatus,
    isLoading,
    queuedCount,
    cases,
    activeCaseIndex,
    dedicatedAgents,
    coreAgentProgress,
    splitMode,
    streamingToolName,
    submitMessage,
    switchCase,
    dismissCase,
    clearQueue,
    onFormSubmit,
    onFormCancel,
    onIntentConfirm,
    onInteractionSelect,
    userId,
    customerId,
    activeCaseId,
    loadHistoricalCase,
    composerAssistEnabled,
    composerAssistMissingDeepseekKey,
    composerMinDraftChars,
  } = useInteraChat()

  const activeCase = cases[activeCaseIndex] ?? null
  const coreAgentTask = coreAgentProgress?.task

  const filteredDedicatedAgents =
    activeCase?.caseId != null
      ? dedicatedAgents.filter((a) => !a.caseId || a.caseId === activeCase.caseId)
      : dedicatedAgents

  const chatPanel = (
    <div className="flex min-h-0 flex-1 flex-col">
      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center pb-10">
          <WelcomeMessage />
          <div className="w-full max-w-chat px-4">
            <VoiceInputBar
              onSubmit={submitMessage}
              queuedCount={queuedCount}
              onClearQueue={clearQueue}
              isResponding={isLoading}
              allowQueueWhileBusy={!splitMode}
              composerAssistEnabled={composerAssistEnabled}
              customerId={customerId}
              assistMissingDeepseekKey={composerAssistMissingDeepseekKey}
              composerMinDraftChars={composerMinDraftChars}
            />
          </div>
        </div>
      ) : (
        <>
          <MessageList
            messages={messages}
            activeCaseId={activeCase?.caseId ?? null}
            isResponding={isLoading}
            coreAgentTask={coreAgentTask}
            executingToolName={streamingToolName}
            skillsCalled={activeCase?.skillsCalled}
            elevateInteractiveForms={splitMode}
            onFormSubmit={onFormSubmit}
            onFormCancel={onFormCancel}
            onIntentConfirm={onIntentConfirm}
            onInteractionSelect={onInteractionSelect}
          />
          <VoiceInputBar
            onSubmit={submitMessage}
            queuedCount={queuedCount}
            onClearQueue={clearQueue}
            isResponding={isLoading}
            allowQueueWhileBusy={!splitMode}
            composerAssistEnabled={composerAssistEnabled}
            customerId={customerId}
            assistMissingDeepseekKey={composerAssistMissingDeepseekKey}
            composerMinDraftChars={composerMinDraftChars}
          />
        </>
      )}
    </div>
  )

  // Case panel — shows all active cases as stacked cards
  const casePanelEl =
    cases.length > 0 ? (
      <CasePanel
        cases={cases}
        activeCaseId={activeCaseId}
        onSwitch={switchCase}
        onDismiss={dismissCase}
        dedicatedAgents={dedicatedAgents}
        coreAgentProgress={coreAgentProgress}
        executingToolName={streamingToolName}
      />
    ) : undefined

  return (
    <ChatShell spacious={splitMode}>
      <header className="flex shrink-0 items-center justify-between px-4 pb-3 pt-4">
        <div className="w-20" />
        <StatusPill status={agentStatus} label="Intera AI" />
        <div className="w-20 flex justify-end">
          <CaseHistoryPanel
            customerId={customerId}
            userId={userId}
            onSelectCase={loadHistoricalCase}
            activeCaseId={activeCaseId}
          />
        </div>
      </header>

      <SplitLayout
        splitMode={splitMode}
        casePanel={casePanelEl}
        mainPanel={chatPanel}
        tabBar={
          cases.length > 0 ? (
            <CaseTabBar
              cases={cases}
              activeIndex={activeCaseIndex}
              onSwitch={switchCase}
              onDismiss={dismissCase}
            />
          ) : undefined
        }
      />

      {/* No floating overlay — case info lives in the left panel */}
    </ChatShell>
  )
}
