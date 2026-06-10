'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AlertCircle, ArrowRight, Building2, Loader2 } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'
import { apiClient } from '@/lib/api/client'
import { ConsoleAuthShell } from '@/components/auth/console-auth-shell'

interface Membership {
  orgId: string
  role: string
  name: string
}

export default function OrgPickerPage() {
  return (
    <Suspense fallback={null}>
      <OrgPicker />
    </Suspense>
  )
}

function OrgPicker() {
  const { locale } = useConsoleLocale()
  const isZh = locale === 'zh'
  const params = useSearchParams()
  const errorParam = params.get('error')

  const [orgs, setOrgs] = useState<Membership[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(errorParam || null)
  const [switching, setSwitching] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiClient<{ orgs: Membership[] }>('/api/auth/memberships')
      .then((r) => {
        if (cancelled) return
        if (r.data?.orgs && Array.isArray(r.data.orgs)) {
          setOrgs(r.data.orgs)
          setError(null)
        } else {
          setError(isZh ? '无法加载组织列表' : 'Unable to load organizations')
        }
      })
      .catch(() => {
        if (!cancelled) setError(isZh ? '加载组织列表失败' : 'Failed to load organizations')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const selectOrg = async (orgId: string) => {
    setSwitching(orgId)
    setError(null)
    try {
      await apiClient('/api/auth/switch-org', { method: 'POST', body: { orgId } })
      window.location.href = '/build/pilot-lab'
    } catch {
      setError(isZh ? '网络错误，请重试。' : 'Network error. Try again.')
      setSwitching(null)
    }
  }

  const roleLabel = (role: string): string => {
    const labels: Record<string, string> = {
      owner: isZh ? '所有者' : 'Owner',
      admin: isZh ? '管理员' : 'Admin',
      operator: isZh ? '操作员' : 'Operator',
      viewer: isZh ? '查看者' : 'Viewer',
    }
    return labels[role] || role
  }

  const statusLabel = error
    ? (isZh ? '组织成员关系需要处理' : 'Membership lookup needs attention')
    : loading
      ? (isZh ? '正在加载组织成员关系' : 'Loading organization memberships')
      : isZh
        ? `可用组织 ${orgs.length} 个`
        : `${orgs.length} organization${orgs.length === 1 ? '' : 's'} available`
  const statusDetail = error
    ? (isZh ? '等当前 session 可用后，再重试一次成员关系查询。' : 'Retry membership lookup once your session is available.')
    : (isZh ? '之后也可以在身份菜单里切换组织。' : 'You can switch later from the identity menu.')

  return (
    <ConsoleAuthShell
      headline={
        <>
          {isZh ? '选择要使用的组织' : 'Pick the organization'}
          <br />
          {isZh ? <>来<em className="text-[#357f7c] not-italic">承载这次会话。</em></> : <>that should <em className="text-[#357f7c] not-italic">frame this session.</em></>}
        </>
      }
      description={isZh ? '如果你的账号属于多个工作区，请先选择这次 Build、Operate 和 Settings 会话要使用的组织。' : 'If your account belongs to more than one workspace, choose the organization that should power the next Build, Operate, and Settings session.'}
      statusLabel={statusLabel}
      statusTone={error ? 'danger' : loading ? 'neutral' : 'success'}
      statusDetail={statusDetail}
      panelEyebrow={isZh ? '工作区访问' : 'Workspace Access'}
      panelTitle={isZh ? '选择组织' : 'Select Organization'}
      panelDescription={isZh ? '进入 Console 前，先选择你要访问的组织。' : 'Choose which organization you want to access before entering the Console.'}
      panelWidthClassName="max-w-[520px]"
    >
      {error ? (
        <div
          role="alert"
          className="mb-5 rounded-[18px] border border-vermillion/18 bg-vermillion/[0.07] px-4 py-3 text-[13px] text-vermillion"
        >
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[24px] border border-white/72 bg-white/[0.74] shadow-[0_18px_36px_rgba(21,23,25,0.05),inset_0_1px_0_rgba(255,255,255,0.7)]">
        {loading ? (
          <div className="space-y-3 px-4 py-4">
            {[0, 1].map((row) => (
              <div key={row} className="flex items-center gap-4 rounded-[18px] border border-black/[0.04] bg-white/78 px-4 py-4">
                <div className="h-11 w-11 animate-pulse rounded-[16px] bg-black/[0.05]" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-3.5 w-32 animate-pulse rounded-full bg-black/[0.05]" />
                  <div className="h-2.5 w-20 animate-pulse rounded-full bg-black/[0.04]" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="px-6 py-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[18px] border border-vermillion/16 bg-vermillion/[0.08] text-vermillion">
              <AlertCircle className="h-5 w-5" />
            </div>
            <p className="mt-4 text-[15px] font-semibold text-[var(--mist)]">{isZh ? '成员关系查询失败' : 'Membership lookup failed'}</p>
            <p className="mt-2 text-[13px] leading-6 text-[var(--fog)]">
              {isZh ? '暂时无法确认你的组织成员关系。等 session 和成员数据可用后再重试。' : 'We could not confirm your organization memberships yet. Retry once the session and membership data are available.'}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 inline-flex items-center justify-center rounded-[16px] border border-[#357f7c]/18 bg-[#357f7c]/[0.08] px-4 py-2.5 text-[13px] font-semibold text-[#357f7c] transition-all hover:bg-[#357f7c]/[0.14]"
            >
              {isZh ? '重试查询' : 'Retry lookup'}
            </button>
          </div>
        ) : orgs.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[18px] border border-black/[0.05] bg-white/85 text-[var(--fog)]">
              <Building2 className="h-5 w-5" />
            </div>
            <p className="mt-4 text-[15px] font-semibold text-[var(--mist)]">{isZh ? '没有组织成员关系' : 'No organization memberships'}</p>
            <p className="mt-2 text-[13px] leading-6 text-[var(--fog)]">
              {isZh ? '你目前还不属于任何组织。请联系管理员邀请你加入。' : 'You do not belong to any organization yet. Contact your administrator for an invitation.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3 p-3">
            {orgs.map((org) => (
              <button
                key={org.orgId}
                onClick={() => selectOrg(org.orgId)}
                disabled={switching !== null}
                className="group flex w-full items-center gap-4 rounded-[20px] border border-black/[0.05] bg-white/[0.82] px-4 py-4 text-left shadow-[0_12px_24px_rgba(21,23,25,0.04)] transition-all hover:border-[#357f7c]/16 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#357f7c]/18 disabled:cursor-not-allowed disabled:opacity-55"
              >
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[16px] border border-[#357f7c]/16 bg-[#357f7c]/[0.08] text-[#357f7c]">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold text-[var(--mist)]">{org.name}</div>
                  <div className="mt-1 text-[12px] capitalize text-[var(--fog)]">{roleLabel(org.role)}</div>
                </div>
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-black/[0.05] bg-white/80 text-[var(--fog)] transition-colors group-hover:text-[#357f7c]">
                  {switching === org.orgId ? (
                    <Loader2 className="h-4.5 w-4.5 animate-spin text-[#357f7c]" />
                  ) : (
                    <ArrowRight className="h-4.5 w-4.5" />
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </ConsoleAuthShell>
  )
}
