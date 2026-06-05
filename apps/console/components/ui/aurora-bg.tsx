'use client'

interface AuroraBgProps {
  variant?: 'dashboard' | 'minimal'
  className?: string
}

export default function AuroraBg({ variant = 'dashboard', className = '' }: AuroraBgProps) {
  const orb3 = variant === 'dashboard'

  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}>
      <div className="aurora-orb aurora-orb-1" />
      <div className="aurora-orb aurora-orb-2" />
      {orb3 && <div className="aurora-orb aurora-orb-3" />}
    </div>
  )
}
