'use client'

// UserLoginScreen — centered user selection gate shown before chat interface

export interface TestUser {
  label: string
  memberId: string
}

const TEST_USERS: TestUser[] = [
  { label: 'User 1', memberId: 'JAYA113C88F' },
  { label: 'User 2', memberId: 'JAYA114BBAA' },
  { label: 'User 3', memberId: 'JAYA11327F2' },
  { label: 'User 4', memberId: 'JAYA1188F57' },
  { label: 'User 5', memberId: 'JAYA11C5184' },
]

interface UserLoginScreenProps {
  onSelect: (user: TestUser) => void
  onAnonymous: () => void
}

export default function UserLoginScreen({ onSelect, onAnonymous }: UserLoginScreenProps) {
  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center px-4">
      <div
        className="w-full max-w-sm rounded-2xl p-8"
        style={{
          background: 'rgba(255, 255, 255, 0.55)',
          backdropFilter: 'blur(24px) saturate(160%)',
          WebkitBackdropFilter: 'blur(24px) saturate(160%)',
          border: '1px solid rgba(255, 255, 255, 0.6)',
          boxShadow: '0 4px 24px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(255, 255, 255, 0.4) inset',
        }}
      >
        <h2 className="mb-2 text-center text-lg font-semibold text-gray-800">
          Select Test User
        </h2>
        <p className="mb-6 text-center text-sm text-gray-500">
          Choose a test account to log in with
        </p>

        <div className="space-y-2.5">
          {TEST_USERS.map((user) => (
            <button
              key={user.memberId}
              onClick={() => onSelect(user)}
              className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left transition-all duration-150"
              style={{
                background: 'rgba(139, 111, 245, 0.06)',
                border: '1px solid rgba(139, 111, 245, 0.12)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(139, 111, 245, 0.12)'
                e.currentTarget.style.borderColor = 'rgba(139, 111, 245, 0.25)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(139, 111, 245, 0.06)'
                e.currentTarget.style.borderColor = 'rgba(139, 111, 245, 0.12)'
              }}
            >
              <span className="text-sm font-medium text-gray-700">{user.label}</span>
              <span className="font-mono text-xs text-gray-400">{user.memberId}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 border-t border-gray-200/50 pt-4">
          <button
            onClick={onAnonymous}
            className="flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm text-gray-500 transition-all duration-150 hover:text-gray-700"
            style={{
              background: 'rgba(255, 255, 255, 0.3)',
              border: '1px solid rgba(0, 0, 0, 0.06)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.5)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)'
            }}
          >
            Continue as Anonymous
          </button>
        </div>
      </div>
    </div>
  )
}
