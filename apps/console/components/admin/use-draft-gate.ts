// Shared draft-gate hook — enforces active=readonly / draft=editable + Save+Publish.
// Phase 6 (2026-06-08): Replaces silent autosave on the model page.
// Reusable by case-types, guardrails, tools as fast-follow.
import { useState, useCallback, useRef, useEffect } from 'react'

export type DraftMode = 'viewing' | 'editing'

export interface DraftGateState {
  mode: DraftMode
  isDirty: boolean
  isSaving: boolean
  isPublishing: boolean
  lastSavedAt: Date | null
}

export interface UseDraftGateInput {
  isActive: boolean
  configId: string
  /** Called when "Edit as draft" creates a fork. Returns the new draft config ID. */
  forkConfig: () => Promise<string>
  /** Save edits to the current draft. Should NOT bust the live cache. */
  saveDraft: (data: Record<string, unknown>) => Promise<void>
  /** Publish the draft. Requires a non-empty commit message. */
  publishDraft: (releaseNote: string) => Promise<void>
}

export function useDraftGate(input: UseDraftGateInput) {
  const [state, setState] = useState<DraftGateState>({
    mode: input.isActive ? 'viewing' : 'editing',
    isDirty: false,
    isSaving: false,
    isPublishing: false,
    lastSavedAt: null,
  })

  const initialValues = useRef<Record<string, unknown> | null>(null)

  // Track dirty state by comparing current values against last saved snapshot
  const markDirty = useCallback((currentValues: Record<string, unknown>) => {
    if (!initialValues.current) {
      initialValues.current = { ...currentValues }
      return
    }
    const dirty = Object.keys(currentValues).some(
      (k) => currentValues[k] !== initialValues.current![k]
    )
    setState((s) => (s.isDirty === dirty ? s : { ...s, isDirty: dirty }))
  }, [])

  const editAsDraft = useCallback(async () => {
    await input.forkConfig()
    setState((s) => ({ ...s, mode: 'editing', isDirty: false }))
  }, [input])

  const save = useCallback(
    async (data: Record<string, unknown>) => {
      setState((s) => ({ ...s, isSaving: true }))
      try {
        await input.saveDraft(data)
        initialValues.current = { ...data }
        setState((s) => ({ ...s, isSaving: false, isDirty: false, lastSavedAt: new Date() }))
      } catch {
        setState((s) => ({ ...s, isSaving: false }))
      }
    },
    [input],
  )

  const publish = useCallback(
    async (releaseNote: string) => {
      if (!releaseNote.trim()) return
      setState((s) => ({ ...s, isPublishing: true }))
      try {
        await input.publishDraft(releaseNote)
        setState((s) => ({ ...s, isPublishing: false, mode: 'viewing' }))
      } catch {
        setState((s) => ({ ...s, isPublishing: false }))
      }
    },
    [input],
  )

  // Discard dirty state when configId changes
  useEffect(() => {
    initialValues.current = null
    setState((s) => ({
      ...s,
      mode: input.isActive ? 'viewing' : 'editing',
      isDirty: false,
      lastSavedAt: null,
    }))
  }, [input.configId, input.isActive])

  return { ...state, markDirty, editAsDraft, save, publish }
}
