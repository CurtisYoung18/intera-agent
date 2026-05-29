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
import CaseHistoryPanel from '@/components/chat/case-history-panel'
import UserLoginScreen from '@/components/chat/user-login-screen'
import type { TestUser } from '@/components/chat/user-login-screen'
import UserPill from '@/components/chat/user-pill'
import DebugExportButton from '@/components/chat/debug-export-button'
import { PenLine } from 'lucide-react'
import { useInteraChat } from './use-intera-chat'

export default function ChatPage() {
  const {
    messages,
    agentStatus,
    isLoading,
    queuedCount,
    cases,
    dedicatedAgents,
    coreAgentProgress,
    splitMode,
    streamingToolName,
    submitMessage,
    dismissCase,
    clearQueue,
    onFormSubmit,
    onFormCancel,
    onIntentConfirm,
    onInteractionSelect,
    userId,
    vendorId,
    chatId,
    activeCaseId,
    loadHistoricalCase,
    composerAssistEnabled,
    composerAssistMissingDeepseekKey,
    composerMinDraftChars,
    selectedUser,
    setSelectedUser,
    isHydrated,
    newChat,
  } = useInteraChat()

  const activeCase = cases.find((c) => c.caseId === activeCaseId) ?? null
  const coreAgentTask = coreAgentProgress?.task

  const handleSelectUser = (user: TestUser) => setSelectedUser(user)
  const handleAnonymous = () => setSelectedUser('anonymous')
  const handleSwitchUser = () => setSelectedUser(null)

  // ── Auth gate ─────────────────────────────────────────────────────────────
  // Wait for localStorage hydration before deciding which screen to show.
  // Without this, every refresh flashes the login screen for one frame even
  // when the user is already logged in.
  if (!isHydrated) {
    return null // blank — avoids layout shift; hydration is near-instant
  }

  if (selectedUser === null) {
    return <UserLoginScreen onSelect={handleSelectUser} onAnonymous={handleAnonymous} />
  }

  const currentUserLabel = selectedUser === 'anonymous' ? 'Anonymous' : selectedUser?.label ?? 'Anonymous'

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
              vendorId={vendorId}
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
            vendorId={vendorId}
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
        onDismiss={dismissCase}
        dedicatedAgents={dedicatedAgents}
        coreAgentProgress={coreAgentProgress}
        executingToolName={streamingToolName}
      />
    ) : undefined

  return (
    <ChatShell spacious={splitMode}>
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 py-2.5 border-b border-black/[0.05]">
        {/* Left — user identity + new chat */}
        <div className="flex items-center gap-2">
          <UserPill label={currentUserLabel} onClick={handleSwitchUser} />
          <button
            onClick={newChat}
            title="New chat"
            aria-label="Start a new chat"
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-black/[0.07] bg-white/40 text-fog/60 backdrop-blur-md shadow-[0_1px_3px_rgba(0,0,0,0.06)] hover:border-black/10 hover:bg-white/65 hover:text-fog/90 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo/25"
          >
            <PenLine className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* Center — agent status */}
        <StatusPill status={agentStatus} label="Intera AI" />

        {/* Right — debug export + history */}
        <div className="flex items-center gap-1.5">
          <DebugExportButton
            chatId={chatId}
            userId={userId}
            vendorId={vendorId}
            messages={messages}
            cases={cases}
            dedicatedAgents={dedicatedAgents}
            coreAgentProgress={coreAgentProgress}
            agentStatus={agentStatus}
          />
          <CaseHistoryPanel
            vendorId={vendorId}
            userId={userId}
            chatId={chatId}
            onSelectCase={loadHistoricalCase}
            activeCaseId={activeCaseId}
          />
        </div>
      </header>

      <SplitLayout
        splitMode={splitMode}
        casePanel={casePanelEl}
        mainPanel={chatPanel}
      />

      {/* No floating overlay — case info lives in the left panel */}
    </ChatShell>
  )
}
