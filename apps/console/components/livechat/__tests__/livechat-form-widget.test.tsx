// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LiveChatFormWidget from '../livechat-form-widget'

const { mockEnsureMomentsSdk, mockCloseMomentIfPossible } = vi.hoisted(() => ({
  mockEnsureMomentsSdk: vi.fn(async () => null),
  mockCloseMomentIfPossible: vi.fn(async () => false),
}))

vi.mock('@/lib/livechat/moments-sdk', () => ({
  ensureMomentsSdk: mockEnsureMomentsSdk,
  closeMomentIfPossible: mockCloseMomentIfPossible,
}))

describe('LiveChatFormWidget', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('submits normalized answers back to the livechat form endpoint', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<{ ok: boolean }> }>>(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <LiveChatFormWidget
        title="Deposit details"
        description="Please fill in the requested details."
        locale="en"
        chatId="chat-1"
        caseId="case-1"
        fields={[
          { key: 'amount', type: 'number', label: 'Amount', required: true },
          { key: 'payment_channel', type: 'select', label: 'Payment channel', required: true, options: ['Bank transfer', 'bKash'] },
        ]}
      />,
    )

    await waitFor(() => {
      expect(mockEnsureMomentsSdk).toHaveBeenCalledWith({ title: 'Deposit details' })
    })

    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '800' } })
    fireEvent.change(screen.getByLabelText(/Payment channel/), { target: { value: 'Bank transfer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/livechat/form-submit', expect.objectContaining({
        method: 'POST',
      }))
    })

    const firstCall = fetchMock.mock.calls[0]
    expect(firstCall).toBeDefined()
    const init = firstCall?.[1] as RequestInit | undefined
    if (!init) throw new Error('expected fetch init')
    expect(init.body).toBe(JSON.stringify({
      chatId: 'chat-1',
      caseId: 'case-1',
      answers: {
        amount: '800',
        payment_channel: 'Bank transfer',
      },
    }))

    expect(await screen.findByText('Submitted')).toBeDefined()
    await waitFor(() => {
      expect(mockCloseMomentIfPossible).toHaveBeenCalledWith({ title: 'Deposit details' })
    })
  })

  it('shows preview output without calling the API', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<unknown>>()
    vi.stubGlobal('fetch', fetchMock)

    render(
      <LiveChatFormWidget
        title="查询最近一次存款详情"
        description="请提供您最近一次存款的具体信息，以便我们帮您查询。"
        locale="zh"
        preview
        fields={[
          { key: 'amount', type: 'number', label: '存款金额', required: true },
        ]}
      />,
    )

    fireEvent.change(screen.getByLabelText(/存款金额/), { target: { value: '800' } })
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockEnsureMomentsSdk).not.toHaveBeenCalled()
    expect(await screen.findByText('已提交')).toBeDefined()
    expect(await screen.findByText(/"amount": "800"/)).toBeDefined()
  })
})
