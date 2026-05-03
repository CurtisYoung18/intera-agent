import * as React from 'react'
import { cn } from '@/lib/utils'

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<'textarea'>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        'flex min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-3 text-[15px] text-mist placeholder:text-fog/30 focus-visible:outline-none focus-visible:border-[var(--border-focus)] focus-visible:shadow-[0_0_0_3px_var(--gold-glow)] disabled:cursor-not-allowed disabled:opacity-50 resize-none font-sans leading-relaxed transition-all duration-300',
        className,
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = 'Textarea'

export { Textarea }
