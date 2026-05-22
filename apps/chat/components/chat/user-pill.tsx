'use client'

// UserPill — small clickable badge in chat header showing current test user

interface UserPillProps {
  label: string
  onClick: () => void
}

export default function UserPill({ label, onClick }: UserPillProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all duration-150"
      style={{
        background: 'rgba(139, 111, 245, 0.08)',
        border: '1px solid rgba(139, 111, 245, 0.15)',
        color: 'rgba(139, 111, 245, 0.9)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(139, 111, 245, 0.14)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(139, 111, 245, 0.08)'
      }}
    >
      <svg width="14" height="14" viewBox="0 0 12 12" fill="none" className="opacity-70">
        <circle cx="6" cy="4" r="2.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M1.5 10.5C1.5 8.5 3.5 6.5 6 6.5C8.5 6.5 10.5 8.5 10.5 10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
      {label}
    </button>
  )
}
