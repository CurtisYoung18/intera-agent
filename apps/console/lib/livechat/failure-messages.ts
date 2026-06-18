import type { LiveChatConfig, LiveChatFailureReason } from './types'

export const DEFAULT_LIVECHAT_FAILURE_MESSAGES: Record<LiveChatFailureReason, string> = {
  engine_unreachable: 'Service is temporarily unavailable. Our systems are recovering - please try again shortly.',
  stream_truncated: 'Sorry, the response was interrupted. Please resend your message.',
  action_failed: 'A technical issue occurred and has been logged. If you do not receive a response soon, please contact support.',
}

export function liveChatFailureMessage(
  config: Pick<LiveChatConfig, 'failureMessages'> | undefined,
  reason: LiveChatFailureReason,
): string {
  const configured = config?.failureMessages?.[reason]?.trim()
  return configured || DEFAULT_LIVECHAT_FAILURE_MESSAGES[reason]
}
