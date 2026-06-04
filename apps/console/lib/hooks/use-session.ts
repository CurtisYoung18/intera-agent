// useSession hook — fetches /api/auth/session once, caches in the SWR store.
// Returns { orgId, role, userId, loading, error }.
// Uses the existing useApi cache key 'session' so it deduplicates across components.

import { apiClient, useApi } from '@/lib/api/client'

interface SessionInfo {
  orgId: string
  role: string
  userId?: string
}

export function useSession() {
  const { data, error, loading } = useApi<SessionInfo>(
    'session',
    () => apiClient<SessionInfo>('/api/auth/session'),
  )
  return {
    orgId: data?.orgId ?? 'default',
    role: data?.role,
    userId: data?.userId,
    loading,
    error,
  }
}
