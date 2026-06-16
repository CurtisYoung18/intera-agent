'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowRight, Search, Puzzle, Shield, Plug, Layers, Brain } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'
import { BuildComponentsLocalNav } from './_components/components-route-shell'

const COMPONENT_ITEMS = [
  { href: '/build/components/brain', icon: Brain, labelKey: 'sidebar.brain', color: '#8b6ff5' },
  { href: '/build/components/procedures', icon: Layers, labelKey: 'sidebar.procedures', color: '#d4912e' },
  { href: '/build/components/tools', icon: Puzzle, labelKey: 'sidebar.tools', color: '#5b8af7' },
  { href: '/build/components/hooks', icon: Shield, labelKey: 'sidebar.hooks', color: '#e64539' },
  { href: '/build/components/knowledge', icon: Search, labelKey: 'sidebar.knowledge', color: '#14b8a6' },
  { href: '/build/components/integrations', icon: Plug, labelKey: 'sidebar.integrations', color: '#7c3aed' },
]

const COMPONENTS_PAGE_COPY = {
  en: {
    heroDescription:
      'Keep Brain, Procedures, Tools, Hooks, Knowledge, and Integrations in one Build workspace with consistent styling and stable save and test flows.',
    localOnlyTitle: 'Local only',
    localOnlyBody: 'Components stays a Build-local hub. It does not become top-level global nav again.',
    flowSafeTitle: 'Flow-safe',
    flowSafeBody: 'Existing save, test, and detail editors remain intact under the updated Build shell.',
    tableComponent: 'Component',
    tableWhat: 'What you can do here',
    tableRoute: 'Route',
    insideWorkspace: 'Inside Components workspace',
    descriptions: {
      'sidebar.brain': 'Configure the agent persona, model, memory strategy, and global prompt.',
      'sidebar.procedures': 'Define the steps, branches, and escalation rules the agent follows for each case type.',
      'sidebar.tools': 'Manage the tools the agent can call, with their parameters and call rules.',
      'sidebar.hooks': 'Insert checks, blocks, and human escalation before or after tool calls and before replies.',
      'sidebar.knowledge': 'Maintain the knowledge base content and retrieval the agent cites when answering.',
      'sidebar.integrations': 'Connect external systems and data sources to extend the agent.',
    } as Record<string, string>,
    openRoute: 'Open route',
  },
  zh: {
    heroDescription:
      '把大脑、流程、工具、钩子、知识库和集成收进同一个 Build 工作区，复用统一的界面风格与稳定的保存、测试流程。',
    localOnlyTitle: '仅限 Build 内部',
    localOnlyBody: 'Components 继续作为 Build 内部工作区存在，不再恢复成全局一级导航。',
    flowSafeTitle: '流程不变',
    flowSafeBody: '现有保存、测试和细节编辑器都会在新的 Build 界面下原样保留。',
    tableComponent: '组件',
    tableWhat: '这里可以做什么',
    tableRoute: '入口',
    insideWorkspace: '位于 Components 工作区',
    descriptions: {
      'sidebar.brain': '配置 Agent 的人设、模型、记忆策略与全局提示词。',
      'sidebar.procedures': '定义 Agent 处理各类客户问题的步骤、分支与升级条件。',
      'sidebar.tools': '管理 Agent 可调用的工具及其参数与调用规则。',
      'sidebar.hooks': '在工具调用前后或回复前插入校验、拦截与人工升级。',
      'sidebar.knowledge': '维护知识库内容与检索，供 Agent 回答时引用。',
      'sidebar.integrations': '连接外部系统与数据源，扩展 Agent 的能力边界。',
    } as Record<string, string>,
    openRoute: '打开入口',
  },
} as const

function isActive(pathname: string, href: string) {
  return pathname === href
}

export default function BuildComponentsPage() {
  const { locale, t } = useConsoleLocale()
  const pathname = usePathname()
  const copy = COMPONENTS_PAGE_COPY[locale]

  return (
    <main className="intera-q2-page min-h-screen px-5 py-6 sm:px-8">
      <div className="mx-auto flex max-w-[1380px] flex-col gap-4">
        <section className="intera-q2-panel overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-[var(--color-border-subtle)] px-5 py-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--color-text-tertiary)]">
                <span>{t('sidebar.build')}</span>
                <span className="text-[var(--color-border-strong)]">/</span>
                <span className="text-[var(--color-text-primary)]">{t('sidebar.components')}</span>
              </div>
              <h1 className="mt-4 text-[30px] font-semibold leading-[1.08] text-[var(--color-text-primary)] sm:text-[34px]">{t('sidebar.components')}</h1>
              <p className="mt-2 max-w-3xl text-[15px] leading-6 text-[var(--color-text-secondary)]">
                {copy.heroDescription}
              </p>
            </div>
            <div className="grid gap-2 text-[12px] text-[var(--color-text-secondary)] sm:grid-cols-2">
              <div className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/76 px-4 py-3 shadow-[0_10px_24px_rgba(21,23,25,0.04)]">
                <p className="font-semibold text-[var(--color-text-primary)]">{copy.localOnlyTitle}</p>
                <p className="mt-1 leading-5">{copy.localOnlyBody}</p>
              </div>
              <div className="rounded-[var(--radius-control)] border border-[rgba(53,127,124,0.18)] bg-[rgba(53,127,124,0.08)] px-4 py-3 text-[var(--color-accent-primary)] shadow-[0_10px_24px_rgba(21,23,25,0.04)]">
                <p className="font-semibold">{copy.flowSafeTitle}</p>
                <p className="mt-1 leading-5">{copy.flowSafeBody}</p>
              </div>
            </div>
          </div>

          <div className="px-5 py-4">
            <BuildComponentsLocalNav />
          </div>
        </section>

        <section className="intera-q2-panel overflow-hidden">
          <div className="hidden grid-cols-[minmax(230px,0.85fr)_minmax(0,1fr)_150px] border-b border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.48)] px-5 py-3 text-[12px] font-semibold text-[var(--color-text-tertiary)] md:grid">
            <span>{copy.tableComponent}</span>
            <span>{copy.tableWhat}</span>
            <span>{copy.tableRoute}</span>
          </div>
          <div className="divide-y divide-[var(--color-border-subtle)]">
            {COMPONENT_ITEMS.map((item) => {
              const active = isActive(pathname, item.href)
              const label = t(item.labelKey)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`group grid gap-3 px-5 py-4 transition-colors md:grid-cols-[minmax(230px,0.85fr)_minmax(0,1fr)_150px] md:items-center ${
                    active
                      ? 'bg-[rgba(53,127,124,0.08)]'
                      : 'bg-[rgba(255,255,255,0.62)] hover:bg-[rgba(255,255,255,0.88)]'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3 text-[14px] font-semibold text-[var(--color-text-primary)]">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-white/70 bg-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.76)]">
                      <item.icon className="h-4.5 w-4.5" style={{ color: item.color }} />
                    </span>
                    <div className="min-w-0">
                      <span className="block">{label}</span>
                      <span className="mt-1 block text-[11px] font-medium text-[var(--color-text-tertiary)]">{copy.insideWorkspace}</span>
                    </div>
                  </div>
                  <p className="text-[13px] leading-5 text-[var(--color-text-secondary)]">
                    {copy.descriptions[item.labelKey] ?? ''}
                  </p>
                  <span className="inline-flex w-fit items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/82 px-2.5 py-1 text-[11px] font-semibold text-[var(--color-text-secondary)]">
                    {copy.openRoute}
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              )
            })}
          </div>
        </section>
      </div>
    </main>
  )
}
