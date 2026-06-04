// Typed API client over the contracts layer.
//
// apiClient — typed fetch wrapper that validates response envelopes.
// useApi     — SWR-style React hook (cache + dedup + revalidate) so the
//              13×-duplicated fetches collapse to one cache key.

'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { z } from 'zod'
import type { ApiEnvelope, ApiErr, ApiOk } from '@intera/shared/contracts/envelope'

// ── Shared in-memory cache ──
// Survives React re-renders but not full page reloads (SWR-style).
// In a future Wave, swap for a proper SWR/React-Query integration.

interface CacheEntry<T> {
  data: T
  ts: number
  error?: never
}

interface CacheError {
  data?: never
  error: ApiErr
  ts: number
}

type CacheSlot<T> = CacheEntry<T> | CacheError

const cache = new Map<string, CacheSlot<unknown>>()
const subscribers = new Map<string, Set<() => void>>()

function subscribe(key: string, cb: () => void) {
  const set = subscribers.get(key) ?? new Set()
  set.add(cb)
  subscribers.set(key, set)
  return () => {
    set.delete(cb)
    if (set.size === 0) subscribers.delete(key)
  }
}

function notify(key: string) {
  subscribers.get(key)?.forEach((cb) => cb())
}

function getSnapshot<T>(key: string): CacheSlot<T> | undefined {
  return cache.get(key) as CacheSlot<T> | undefined
}

// ── apiClient ──
interface ClientOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
}

class ApiClientError extends Error {
  constructor(public envelope: ApiErr) {
    super(envelope.error.message)
    this.name = 'ApiClientError'
  }
}

async function apiClient<T = unknown>(
  url: string,
  options: ClientOptions = {},
): Promise<ApiOk<T>> {
  const { method, body, headers = {} } = options
  const fetchOptions: RequestInit = {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...headers },
  }
  if (body !== undefined) {
    fetchOptions.body = JSON.stringify(body)
  }

  const res = await fetch(url, fetchOptions)
  const json = await res.json()

  if (json && json.ok === true) {
    return json as ApiOk<T>
  }
  if (json && json.ok === false) {
    throw new ApiClientError(json as ApiErr)
  }
  // Fallback for non-envelope responses from unmigrated routes
  return { ok: true, data: json as T }
}

// ── useApi hook ──
interface UseApiResult<T> {
  data: T | undefined
  error: ApiErr | undefined
  loading: boolean
  mutate: (data?: T) => void
  revalidate: () => Promise<void>
}

function useApi<T = unknown>(
  key: string | null,
  fetcher: () => Promise<ApiOk<T>>,
): UseApiResult<T> {
  const [, setTick] = useState(0)
  const pendingRef = useRef<Promise<ApiOk<T>> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const slot = useSyncExternalStore(
    useCallback((cb: () => void) => (key ? subscribe(key, cb) : () => {}), [key]),
    useCallback(() => (key ? getSnapshot<T>(key) : undefined), [key]),
  )

  const loading = key !== null && slot === undefined

  const revalidate = useCallback(async () => {
    if (!key) return
    // Dedup: if there's already a pending fetch for this key, reuse it
    if (pendingRef.current) {
      await pendingRef.current
      return
    }
    const promise = fetcher().then((result) => {
      if (result.ok) {
        cache.set(key, { data: result.data as T, ts: Date.now() })
      }
      pendingRef.current = null
      notify(key)
      return result
    }).catch((err) => {
      pendingRef.current = null
      if (err instanceof ApiClientError) {
        cache.set(key, { error: err.envelope, ts: Date.now() })
        notify(key)
      } else {
        cache.set(key, {
          error: { ok: false, error: { code: 'internal', message: String(err) } },
          ts: Date.now(),
        })
        notify(key)
      }
      throw err
    })
    pendingRef.current = promise
    await promise
  }, [key, fetcher])

  const mutate = useCallback(
    (data?: T) => {
      if (!key) return
      if (data === undefined) {
        cache.delete(key)
      } else {
        cache.set(key, { data, ts: Date.now() })
      }
      notify(key)
      setTick((n) => n + 1)
    },
    [key],
  )

  // Initial fetch
  useEffect(() => {
    if (!key || slot !== undefined) return
    revalidate().catch(() => {})
  }, [key, slot, revalidate])

  return {
    data: slot && 'data' in slot ? slot.data : undefined,
    error: slot && 'error' in slot ? slot.error : undefined,
    loading,
    mutate,
    revalidate,
  }
}

export { apiClient, ApiClientError, useApi }
export type { UseApiResult }
