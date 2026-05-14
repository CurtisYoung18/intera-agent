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

function readSessionFromUrl(): { customerId: string; userId: string; caseType: string } {
  if (typeof window === 'undefined') {
    return { customerId: 'default', userId: 'anonymous', caseType: 'general' }
  }
  const q = new URLSearchParams(window.location.search)
  return {
    customerId: q.get('customer') || q.get('tenant') || 'default',
    userId: q.get('user') || 'anonymous',
    caseType: (q.get('caseType') || q.get('type') || 'general').replace(/_/g, ' '),
  }
}

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
  } = useInteraChat()

  const session = readSessionFromUrl()
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

  const headlineType = (activeCase?.caseType || session.caseType).replace(/_/g, ' ')
  const caseLine = activeCase?.caseId
    ? (activeCase.caseId.length > 36 ? `${activeCase.caseId.slice(0, 28)}…` : activeCase.caseId)
    : `case_${Date.now().toString(36)}`

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
          />
        </>
      )}
    </div>
  )

  return (
    <ChatShell>
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="grid grid-cols-[minmax(2rem,2.75rem)_1fr_minmax(2rem,2.75rem)] items-start gap-1 px-2 pt-4 pb-3 flex-shrink-0">
        <div className="w-10 shrink-0" aria-hidden />
        <div className="min-w-0 text-center px-2">
          <p className="text-[14px] sm:text-[15px] leading-snug text-mist">
            <span className="text-indigo">{session.customerId}</span>
            <span className="text-fog/35 mx-1.5 font-normal">·</span>
            <span className="font-semibold capitalize">{headlineType}</span>
          </p>
          <p className="mt-1 text-[11px] leading-snug tracking-tight text-fog/55">
            Case <span className="font-mono tabular-nums text-fog/[0.65]">{caseLine}</span>
            <span className="mx-1.5 text-fog/35">·</span>
            User {session.userId}
          </p>
        </div>
        <div className="flex shrink-0 justify-end pt-0.5">
          <StatusPill status={agentStatus} label="Intera AI" />
        </div>
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
