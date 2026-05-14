'use client'

// Intera Harness — Chat Page
// Single-column chat with split-to-side-panel animation on case creation.
// Multi-case support via bottom tab bar.

import ChatShell from '@/components/chat/chat-shell'
import StatusPill from '@intera/shared/ui/status-pill'
import MessageList from '@/components/chat/message-list'
import VoiceInputBar from '@/components/chat/voice-input-bar'
import WelcomeMessage from '@/components/chat/welcome-message'
import CaseCard from '@/components/chat/case-card'
import SplitLayout from '@/components/chat/split-layout'
import DedicatedAgentsPanel from '@/components/chat/dedicated-agents-panel'
import CaseTabBar from '@/components/chat/case-tab-bar'
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
    splitMode,
    rightPanelCollapsed,
    submitMessage,
    switchCase,
    toggleRightPanel,
    dismissCase,
    clearQueue,
    onFormSubmit,
    onFormCancel,
    customerId,
    composerAssistEnabled,
    composerAssistMissingDeepseekKey,
    composerMinDraftChars,
  } = useInteraChat()

  const activeCase = cases[activeCaseIndex] ?? null

  const caseCard = activeCase
    ? {
        caseId: activeCase.caseId,
        title: activeCase.displayName,
        type: activeCase.caseType,
        status: activeCase.status as CaseStatus,
        confirmedFacts: activeCase.confirmedFacts,
        skillsCalled: activeCase.skillsCalled,
        missingFacts: activeCase.missingFacts,
      }
    : null

  // ── Chat content (shared between single and split layouts) ──
  const chatPanel = (
    <div className="flex-1 flex flex-col min-h-0">
      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center pb-10">
          <WelcomeMessage />
          <div className="w-full max-w-chat px-4">
            <VoiceInputBar
              onSubmit={submitMessage}
              queuedCount={queuedCount}
              onClearQueue={clearQueue}
              isResponding={isLoading}
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
            isResponding={isLoading}
            onFormSubmit={onFormSubmit}
            onFormCancel={onFormCancel}
          />
          <VoiceInputBar
            onSubmit={submitMessage}
            queuedCount={queuedCount}
            onClearQueue={clearQueue}
            isResponding={isLoading}
            composerAssistEnabled={composerAssistEnabled}
            customerId={customerId}
            assistMissingDeepseekKey={composerAssistMissingDeepseekKey}
            composerMinDraftChars={composerMinDraftChars}
          />
        </>
      )}
    </div>
  )

  return (
    <ChatShell>
      {/* ── Header — brand pill only (session/case/debug lines removed) ─ */}
      <header className="flex flex-shrink-0 justify-center px-2 pt-4 pb-3">
        <StatusPill status={agentStatus} label="Intera AI" />
      </header>

      {/* ── Split layout with side panel ─────────────────────────── */}
      <SplitLayout
        splitMode={splitMode}
        collapsed={rightPanelCollapsed}
        onToggleCollapse={toggleRightPanel}
        mainPanel={chatPanel}
        sidePanel={
          <DedicatedAgentsPanel
            agents={dedicatedAgents}
            collapsed={rightPanelCollapsed}
            onToggleCollapse={toggleRightPanel}
          />
        }
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

      {/* ── Floating Case Dashboard ──────────────────────────────── */}
      <CaseCard data={caseCard} onDismiss={() => dismissCase(activeCase?.caseId || '')} />
    </ChatShell>
  )
}
