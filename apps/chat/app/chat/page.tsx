'use client'

// Intera Harness — Chat Page
// Single-column chat; with an active case, a slim investigation rail on the left.

import ChatShell from '@/components/chat/chat-shell'
import StatusPill from '@intera/shared/ui/status-pill'
import MessageList from '@/components/chat/message-list'
import VoiceInputBar from '@/components/chat/voice-input-bar'
import WelcomeMessage from '@/components/chat/welcome-message'
import CaseCard from '@/components/chat/case-card'
import SplitLayout from '@/components/chat/split-layout'
import CaseInvestigationRail from '@/components/chat/case-investigation-rail'
import CaseTabBar from '@/components/chat/case-tab-bar'
import CaseHistoryPanel from '@/components/chat/case-history-panel'
import { useInteraChat } from './use-intera-chat'
import type { CaseStatus } from '@/components/chat/case-card'

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

  const caseCard = activeCase
    ? {
        caseId: activeCase.caseId,
        title: activeCase.displayName,
        type: activeCase.caseType,
        status: activeCase.status as CaseStatus,
        confirmedFacts: activeCase.confirmedFacts,
        skillsCalled: activeCase.skillsCalled,
        missingFacts: activeCase.missingFacts,
        stage: coreAgentProgress?.stage,
        subAgentCount: filteredDedicatedAgents.length,
        subAgentsRunning: filteredDedicatedAgents.some((a) => a.status === 'executing'),
      }
    : null

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

  const caseRail =
    splitMode && caseCard ? (
      <CaseInvestigationRail
        casePayload={caseCard}
        onDismissCase={activeCase ? () => dismissCase(activeCase.caseId) : undefined}
        dedicatedAgents={filteredDedicatedAgents}
        cases={cases}
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
        leftRail={caseRail}
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

      {!splitMode && (
        <CaseCard data={caseCard} onDismiss={() => dismissCase(activeCase?.caseId || '')} />
      )}
    </ChatShell>
  )
}
