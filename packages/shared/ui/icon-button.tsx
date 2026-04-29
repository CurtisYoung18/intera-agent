// IconButton — minimal icon button with glass variant

import type { ReactNode } from 'react'

interface IconButtonProps {
  icon: ReactNode
  label: string
  onClick?: () => void
  variant?: 'ghost' | 'glass'
  size?: 'sm' | 'md'
  className?: string
}

const SIZE_STYLES = {
  sm: 'w-7 h-7 rounded-md',
  md: 'w-8 h-8 rounded-lg',
}

const VARIANT_STYLES = {
  ghost:
    'bg-transparent hover:bg-white/5 text-fog hover:text-mist',
  glass:
    'bg-white/[0.03] backdrop-blur-[12px] border border-white/[0.04] text-fog hover:text-mist hover:bg-white/[0.06]',
}

export default function IconButton({
  icon,
  label,
  onClick,
  variant = 'ghost',
  size = 'md',
  className = '',
}: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`
        inline-flex items-center justify-center
        transition-all duration-150 ease-out
        ${SIZE_STYLES[size]}
        ${VARIANT_STYLES[variant]}
        ${className}
      `}
    >
      {icon}
    </button>
  )
}
