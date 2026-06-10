'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

export interface SlashPlaceholderItem {
  token: string
  label: string
  description: string
  typeLabel: string
}

export interface SlashPlaceholderGroup {
  id: string
  label: string
  description: string
  items: SlashPlaceholderItem[]
}

interface Props {
  ariaLabel?: string
  id?: string
  value: string
  onChange: (value: string) => void
  groups: SlashPlaceholderGroup[]
  placeholder?: string
  minHeightClassName?: string
  helperText?: string
}

interface MenuState {
  slashIndex: number
  groupId: string | null
}

export default function SlashPlaceholderEditor({
  ariaLabel,
  id,
  value,
  onChange,
  groups,
  placeholder,
  minHeightClassName = 'min-h-[240px]',
  helperText,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [menuState, setMenuState] = useState<MenuState | null>(null)

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (!target) return
      if (shellRef.current?.contains(target)) return
      setMenuState(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  const activeGroup = useMemo(
    () => groups.find((group) => group.id === menuState?.groupId) ?? null,
    [groups, menuState?.groupId],
  )

  const openRootMenu = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    const caret = textarea.selectionStart ?? value.length
    setMenuState({ slashIndex: Math.max(0, caret - 1), groupId: null })
  }

  const closeMenu = () => setMenuState(null)

  const insertToken = (token: string) => {
    const textarea = textareaRef.current
    if (!textarea || !menuState) return
    const caret = textarea.selectionStart ?? value.length
    const start = Math.min(menuState.slashIndex, caret)
    const nextValue = `${value.slice(0, start)}{{${token}}}${value.slice(caret)}`
    onChange(nextValue)
    closeMenu()
    requestAnimationFrame(() => {
      const nextCaret = start + token.length + 4
      textarea.focus()
      textarea.setSelectionRange(nextCaret, nextCaret)
    })
  }

  return (
    <div ref={shellRef} className="relative">
      <textarea
        aria-label={ariaLabel}
        id={id}
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyUp={(event) => {
          if (event.key === '/') {
            openRootMenu()
            return
          }
          if (event.key === 'Escape') {
            closeMenu()
          }
        }}
        spellCheck={false}
        placeholder={placeholder}
        className={`glass-input-console w-full resize-y px-4 py-3 font-mono text-[12px] leading-relaxed ${minHeightClassName}`}
        style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' }}
      />

      {helperText ? <p className="mt-2 text-[11px] text-[var(--fog)]">{helperText}</p> : null}

      {menuState ? (
        <div className="absolute left-0 top-full z-20 mt-3 w-full max-w-[420px] rounded-[18px] border border-black/[0.08] bg-white/96 p-3 shadow-[0_24px_60px_rgba(21,23,25,0.14)] backdrop-blur">
          {activeGroup ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[12px] font-semibold text-[var(--mist)]">{activeGroup.label}</div>
                  <p className="mt-1 text-[11px] leading-5 text-[var(--fog)]">{activeGroup.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setMenuState((current) => current ? { ...current, groupId: null } : null)}
                  className="rounded-full border border-black/[0.08] px-3 py-1 text-[11px] font-medium text-[var(--fog)] transition hover:bg-black/[0.04]"
                >
                  Back
                </button>
              </div>

              <div className="space-y-2">
                {activeGroup.items.map((item) => (
                  <button
                    key={item.token}
                    type="button"
                    onClick={() => insertToken(item.token)}
                    className="flex w-full items-start justify-between gap-3 rounded-[14px] border border-black/[0.06] bg-white px-3 py-2 text-left transition hover:border-[rgba(53,127,124,0.2)] hover:bg-[rgba(53,127,124,0.05)]"
                  >
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold text-[var(--mist)]">{`{{${item.token}}}`}</div>
                      <div className="mt-1 text-[11px] leading-5 text-[var(--fog)]">{item.description}</div>
                    </div>
                    <span className="shrink-0 rounded-full bg-black/[0.04] px-2 py-1 text-[10px] font-semibold text-[var(--fog)]">
                      {item.typeLabel}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="text-[12px] font-semibold text-[var(--mist)]">Insert runtime placeholder</div>
                <p className="mt-1 text-[11px] leading-5 text-[var(--fog)]">Type <code>/</code> inside the editor, then choose a runtime data group.</p>
              </div>
              <div className="space-y-2">
                {groups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => setMenuState((current) => current ? { ...current, groupId: group.id } : null)}
                    className="w-full rounded-[14px] border border-black/[0.06] bg-white px-3 py-2 text-left transition hover:border-[rgba(53,127,124,0.2)] hover:bg-[rgba(53,127,124,0.05)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[12px] font-semibold text-[var(--mist)]">{group.label}</div>
                        <div className="mt-1 text-[11px] leading-5 text-[var(--fog)]">{group.description}</div>
                      </div>
                      <span className="shrink-0 rounded-full bg-black/[0.04] px-2 py-1 text-[10px] font-semibold text-[var(--fog)]">
                        {group.items.length} tokens
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
