#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const TRACE_DIR = path.join(ROOT, 'doc/production-chat-traces')
const AUDIT_DIR = path.join(ROOT, 'doc/production-chat-trace-audits')
const REPORT_DIR = path.join(ROOT, 'doc/reports')
const TRACE_HTML_DIR = path.join(REPORT_DIR, 'production-chat-traces')
const AUDIT_HTML_DIR = path.join(REPORT_DIR, 'production-chat-trace-audits')
const STABLE_DASHBOARD = path.join(REPORT_DIR, 'production-chat-trace-audit-dashboard.html')
const today = new Date().toISOString().slice(0, 10)
const DAILY_DASHBOARD = path.join(REPORT_DIR, `production-chat-trace-audit-dashboard-${today}.html`)

const CATEGORY_DEFINITIONS = [
  {
    id: 'procedure',
    label: '流程',
    title: '流程状态机 / 持久化运行',
    tone: 'red',
    keywords: ['procedure', 'procedurerun', 'start_procedure', 'finalize_procedure', 'case type', '状态机', 'durable', 'runid', 'alias'],
    problem: '旧流程 id、没有持久化 ProcedureRun、finalize 空 runId、active/pending 状态不闭环，会让 case 和 trace 看起来“执行了”，但 runtime 实际没有可靠状态。',
    solution: '流程 id 做显式 alias 或失败关闭；start/finalize 必须绑定真实 runId；active/pending/handed_off/resolved 都由 runtime 持久化状态驱动。',
    acceptance: '任何流程工具返回 ok 时都能在 trace 中追到 runId、当前步骤和终态结果；没有 run 时必须显式失败并要求重新路由。',
  },
  {
    id: 'handoff',
    label: '转人工',
    title: '转人工真实性 / Runtime 确认',
    tone: 'red',
    keywords: ['handoff', 'human task', 'create_human_task', 'operator', 'forward', 'transfer', '人工', '转交', 'escalat'],
    problem: '模型会自由生成“已转交/会转交/relevant department/operator task”等承诺，但真实动作必须是 HumanTask 已持久化；另有 create_human_task 成功后客户可见确认缺失或语言不一致。',
    solution: '更原生的修法：工具调用是动作，runtime message 是回执。模型只判断是否需要人工并调用 create_human_task；工具返回已持久化 task 后，由 runtime 自动发送固定/本地化客户确认。Stop Hook 只做兜底：看到类似转人工的文案但没有持久化 HumanTask 证据，就拦截并 nudge 模型调用工具或改写。',
    acceptance: '没有持久化 HumanTask 时客户看不到任何已转交承诺；有持久化 HumanTask 时 runtime 自动发送本地化确认，并把 taskId、queue、known facts 写入 trace。',
  },
  {
    id: 'member',
    label: '会员 ID',
    title: '会员 ID / Live Tool 参数可信度',
    tone: 'red',
    keywords: ['member id', 'member_id', 'jaya', 'unknown', 'placeholder', 'profile', 'form', 'live tool', 'invalid member'],
    problem: '空 member_id、unknown、JAYA、JAYA123456 等占位或半截 id 会进入 live tools、handoff known_facts 或记忆；新一轮 P1 证明表单占位值可被真实提交并触发 live deposit 查询。',
    solution: '共享会员 ID validator 与来源标记：profile、user_text、image_ocr、form 都要标来源；表单占位值不可提交；进入 live tools、handoff serialization、memory 前拒绝占位值/示例值。',
    acceptance: 'JAYA、unknown、JAYA123456、表单占位值都不会触发外部 live tool；若 profile/图片有可信 ID，优先复用并在 trace 标来源。',
  },
  {
    id: 'transcript',
    label: '消息记录',
    title: '消息 / ActionTrace / Provider Transcript 一致性',
    tone: 'amber',
    keywords: ['message', 'messages', 'transcript', 'action trace', 'provider transcript', 'empty', 'visible', 'missing', '空', '持久化'],
    problem: '核心用户消息或 assistant 回复可出现在 action_traces/provider transcript，但缺失于 messages；空 tool-use row 也可能客户可见，导致回放和模型后续上下文分裂。',
    solution: '建立唯一的客户可见消息写入器：客户可见消息先落 messages，再关联 provider/action trace；内部 tool rows 只进 trace，不进入客户可见 transcript。',
    acceptance: '每个客户可见 turn 都能从 messages 回放；内部工具/diagnostic 不产生空白可见行；trace repair 事件有操作员标记。',
  },
  {
    id: 'output',
    label: '输出',
    title: '输出治理 / 语言 / 证据边界',
    tone: 'amber',
    keywords: ['devanagari', 'romanized', 'language', 'stop hook', 'reply', 'answer', '输出', '语言', 'evidence', 'claim'],
    problem: 'Devanagari 泄漏、无证据具体数值、已检查/已转交等权威声明可能绕过最终发送层治理。',
    solution: '最终发送层统一输出守卫，覆盖普通回复、表单、fallback、runtime-owned confirmation；证据型 claim 要有 tool/result id。',
    acceptance: '违规输出在发送前被改写或拦截；客户可见文本和 trace 都能看到守卫决策。',
  },
  {
    id: 'kb',
    label: '知识库',
    title: '知识库检索 / FAQ 证据绑定',
    tone: 'amber',
    keywords: ['kb', 'knowledge', 'faq', 'retrieval', 'ground', 'promotion', 'bonus', 'policy'],
    problem: '简单问题会 fan-out 多次知识库检索；有时用相邻知识库回答，或把未识别 promotion/bonus 当成具体规则。',
    solution: '检索 query 标准化，FAQ 路径约束“只说返回证据”；未识别 promotion 先问名称/截图，不引用具体数值。',
    acceptance: '回答中的具体规则都能链接到返回 KB；无命中时明确询问补充信息。',
  },
  {
    id: 'form',
    label: '表单',
    title: '表单收集 / 活跃表单续接',
    tone: 'amber',
    keywords: ['form', 'ask_user_questions', 'placeholder', 'waiting_for_form', 'pending form', '表单', 'plain text'],
    problem: '需要结构化收集时退化成普通文本追问；表单待提交期间普通聊天路径可能并行回答，打断流程续接。',
    solution: '活跃表单是 runtime state；待提交时相关输入默认绑定当前流程；占位值必须是不可提交的空值。',
    acceptance: '缺会员 ID 等字段时始终使用表单；提交前做 schema 校验；后续消息不会绕开待提交表单。',
  },
  {
    id: 'intent',
    label: '意图',
    title: '意图纠偏 / 话题切换',
    tone: 'amber',
    keywords: ['intent', 'route', 'misroute', 'withdrawal', 'deposit', 'topic switch', 'clarified', '改口', '路由'],
    problem: '客户从 deposit 改口 withdrawal、截图改变证据类型、或话题切换时，活跃流程仍沿旧路径执行。',
    solution: '每轮做意图纠偏 gate；若新证据与活跃流程 family 冲突，暂停/切换并记录原因。',
    acceptance: 'deposit/withdrawal 互相纠正时不会调用错误 family 的 live tool；trace 显示纠偏决策。',
  },
  {
    id: 'sla',
    label: 'SLA',
    title: 'Deposit / Withdrawal SLA 与过期 live 证据',
    tone: 'amber',
    keywords: ['sla', 'pending', 'approved', 'rejected', 'minutes', 'seconds', 'wait', 'stale', 'refresh', 'elapsed'],
    problem: 'pending/approved/rejected 状态没有按 live created_at 和业务 SLA 计算，follow-up 可能复用过期秒数或继续让用户等待。',
    solution: 'live evidence 带 observedAt + createdAt；每次 follow-up 重新计算 elapsed，并按阈值进入 resolved / wait / handoff。',
    acceptance: '接近或超过 SLA 的回复可解释具体 elapsed 与下一步；超过阈值不再泛泛 “please wait”。',
  },
  {
    id: 'metadata',
    label: '可观测性',
    title: 'Provider 元数据 / Trace 可观测性',
    tone: 'neutral',
    keywords: ['provider', 'metadata', 'model', 'token', 'cache', 'openai', 'anthropic', 'observability'],
    problem: 'providerFamily 与实际 route 不一致；简单 continuation 可能 cache miss/token spike。',
    solution: 'metadata 从实际 request route 写入；低噪声记录 cache/token/compaction/orphan repair 指标。',
    acceptance: 'message metadata 与 action_trace model id 一致，token/cache 异常可报警。',
  },
]

const GENERATOR_NOTE = '由 scripts/generate-production-chat-trace-dashboard.mjs 生成'
const FIX_MARKERS = [
  {
    title: '会员 ID / 表单占位值观察基线',
    time: '2026-06-24 16:54 CST',
    since: '2026-06-24T16:54:00+08:00',
    commit: '0a225b4f',
    scope: '表单与富消息 trace 同步、handoff note 可见性，以及当前会员 ID 表单行为基线。',
    note: '此时间前的 JAYA123456/JAYA1234567 占位值事件只作为历史上下文；只有基线后的 trace 才算会员 ID / 表单修复的新复现证据。',
  },
  {
    title: '内部运行时反馈隔离基线',
    time: '2026-06-24 17:22 CST',
    since: '2026-06-24T17:22:00+08:00',
    commit: '11901373',
    scope: 'Stop Hook 反馈、流程 runtime nudge、queued-runtime 输入指令现在写入内部 provider message，不再写成客户可见 user message。',
    note: '此时间前的 [HOOK: Stop]、[PROCEDURE RUNTIME]、[SYSTEM] runtime-control 行只作为历史上下文；只有基线后的可见消息泄漏才算新复现证据。',
  },
  {
    title: '流程焦点 / 表单推进部署基线',
    time: '2026-06-24 17:49 CST',
    since: '2026-06-24T17:49:00+08:00',
    commit: '7cc67db8',
    scope: '已部署按 ProcedureRun 作用域推进输入：表单事实仍在整段聊天中共享，但 ask-action 完成和 paused-run 恢复只绑定拥有它的 active run/runId。',
    note: '此部署前的流程焦点、旧表单答案、未按作用域绑定的人工作业结果问题均视为历史；部署后若切换后的流程仍被另一个 run 的表单/人工结果推进，或 paused run 在没有匹配 runId 时重新获得焦点，才算新复现。',
    watch: {
      label: '流程焦点 / 作用域推进复现观察',
      groups: [
        ['form answer', 'formAnswers', 'customer_form_result', 'human_task_result', 'runId', 'paused run', 'paused ProcedureRun', '表单', '人工结果'],
        ['old procedure', 'another run', 'wrong run', 'steal active focus', 'regain focus', 'resume paused', 'complete ask', 'advanced by', 'progress', '抢焦点', '失焦', '恢复', '推进', '污染', '错绑'],
      ],
    },
  },
]

const RESOLVED_AUDITS = {
  TH12XG7AWZ: {
    status: 'fixed',
    fixedAt: '2026-06-24 17:49 CST',
    commit: '7e85eb95 + 11901373',
    note: '历史 P0。转人工承诺已由固定话术、持久化 HumanTask 的 Stop Hook 兜底、内部 runtime 反馈隔离共同保护。只保留为回归样本；除非 marker 后 trace 再次复现“承诺转人工但没调工具”，否则不计入当前 P0。',
  },
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function readMarkdownFiles(dir, { includeIndex = false } = {}) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .filter((name) => includeIndex || !['README.md', 'INDEX.md'].includes(name))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const filePath = path.join(dir, name)
      return {
        name,
        base: name.replace(/\.md$/, ''),
        path: filePath,
        markdown: fs.readFileSync(filePath, 'utf8'),
        mtimeMs: fs.statSync(filePath).mtimeMs,
      }
    })
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;')
}

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      return `<a href="${escapeAttr(href)}">${escapeHtml(label)}</a>`
    })
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const html = []
  let listOpen = false
  let codeOpen = false
  let tableLines = []
  let paraLines = []

  const closeList = () => {
    if (listOpen) {
      html.push('</ul>')
      listOpen = false
    }
  }
  const flushPara = () => {
    if (!paraLines.length) return
    html.push(`<p>${inlineMarkdown(paraLines.join(' '))}</p>`)
    paraLines = []
  }
  const flushTable = () => {
    if (!tableLines.length) return
    const rows = tableLines
      .filter((line) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line))
      .map((line) =>
        line
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((cell) => cell.trim()),
      )
    if (rows.length) {
      const [head, ...body] = rows
      html.push('<div class="table-scroll"><table>')
      html.push(`<thead><tr>${head.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead>`)
      html.push('<tbody>')
      for (const row of body) {
        html.push(`<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`)
      }
      html.push('</tbody></table></div>')
    }
    tableLines = []
  }

  for (const line of lines) {
    if (line.startsWith('```')) {
      flushPara()
      flushTable()
      closeList()
      if (codeOpen) {
        html.push('</code></pre>')
        codeOpen = false
      } else {
        html.push('<pre><code>')
        codeOpen = true
      }
      continue
    }
    if (codeOpen) {
      html.push(`${escapeHtml(line)}\n`)
      continue
    }

    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushPara()
      closeList()
      tableLines.push(line)
      continue
    }
    flushTable()

    const heading = /^(#{1,4})\s+(.+)$/.exec(line)
    if (heading) {
      flushPara()
      closeList()
      const level = Math.min(heading[1].length + 1, 5)
      const text = heading[2].trim()
      const id = slugify(text)
      html.push(`<h${level} id="${escapeAttr(id)}">${inlineMarkdown(text)}</h${level}>`)
      continue
    }

    const bullet = /^\s*[-*]\s+(.+)$/.exec(line)
    if (bullet) {
      flushPara()
      if (!listOpen) {
        html.push('<ul>')
        listOpen = true
      }
      html.push(`<li>${inlineMarkdown(bullet[1])}</li>`)
      continue
    }

    if (!line.trim()) {
      flushPara()
      closeList()
      continue
    }

    paraLines.push(line.trim())
  }

  flushPara()
  flushTable()
  closeList()
  if (codeOpen) html.push('</code></pre>')
  return html.join('\n')
}

function extractField(markdown, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^-\\s+${escaped}:\\s+(.+)$`, 'im').exec(markdown)
  return match ? match[1].trim().replace(/^`|`$/g, '') : ''
}

function extractSection(markdown, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s+|\\z)`, 'im').exec(markdown)
    if (match) return match[1].trim()
  }
  return ''
}

function firstParagraph(text) {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .find(Boolean) ?? ''
}

function stripMarkdown(value) {
  return String(value ?? '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseTimestampMs(value) {
  const text = String(value ?? '').replace(/`/g, '').trim()
  const match = /(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?(?:\s*(Asia\/Shanghai|CST))?/i.exec(text)
  if (!match) return 0
  const [, date, time, fraction = ''] = match
  return Date.parse(`${date}T${time}${fraction}+08:00`) || 0
}

function traceUpdatedAt(trace) {
  if (!trace) return { label: '', ms: 0 }
  const raw = extractField(trace.markdown, '更新时间') || extractField(trace.markdown, 'Updated at')
  return { label: raw, ms: parseTimestampMs(raw) }
}

function sourceTraceName(markdown) {
  const source = extractField(markdown, 'Source trace')
  return source ? path.basename(source) : ''
}

function chatIdFromName(name) {
  return name
    .replace(/^production-chat-trace-\d{4}-\d{2}-\d{2}-/, '')
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')
    .replace(/\.md$/, '')
    .replace(/-case_.+$/, '')
    .replace(/-followup$/, '')
}

function categorize(text) {
  const lower = text.toLowerCase()
  return CATEGORY_DEFINITIONS.filter((category) => category.keywords.some((keyword) => lower.includes(keyword.toLowerCase()))).map(
    (category) => category.id,
  )
}

function severityRank(severity) {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[severity] ?? 9
}

function categoryLabel(categoryId) {
  if (categoryId === 'uncategorized') return '未分类'
  return CATEGORY_DEFINITIONS.find((category) => category.id === categoryId)?.label ?? categoryId
}

function htmlFileFor(doc, dir) {
  return path.join(dir, `${doc.base}.html`)
}

function relative(fromFile, targetFile) {
  return path.relative(path.dirname(fromFile), targetFile).split(path.sep).join('/')
}

function pageChrome({ title, eyebrow, navLinks, body }) {
  const nav = navLinks
    .filter(Boolean)
    .map((link) => `<a href="${escapeAttr(link.href)}">${escapeHtml(link.label)}</a>`)
    .join('')
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="${GENERATOR_NOTE}">
  <link rel="icon" href="data:,">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; --bg:#f7f4ef; --ink:#22231f; --muted:#676b63; --line:#ddd6ca; --panel:#fffdf9; --soft:#ece5d9; --red:#b3261e; --red-bg:#fff0ef; --amber:#8a5a00; --amber-bg:#fff7e0; --green:#256b3d; --green-bg:#edf8ef; --blue:#1d5f8c; --blue-bg:#eef7ff; }
    * { box-sizing: border-box; }
    body { margin:0; font:15px/1.62 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:var(--bg); color:var(--ink); }
    a { color:inherit; text-decoration-thickness:1px; text-underline-offset:3px; }
    code { padding:1px 5px; border:1px solid var(--line); border-radius:5px; background:#f3eee6; font-size:.92em; }
    pre { overflow:auto; padding:16px; border:1px solid var(--line); border-radius:8px; background:#171814; color:#f8f0df; font-size:13px; line-height:1.55; }
    .page { max-width:1240px; margin:0 auto; padding:28px 24px 52px; }
    .top-nav { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:22px; }
    .top-nav a { display:inline-flex; align-items:center; min-height:34px; padding:5px 10px; border:1px solid var(--line); border-radius:7px; background:var(--panel); text-decoration:none; font-size:13px; }
    .hero { display:grid; grid-template-columns:minmax(0,1fr) 340px; gap:22px; align-items:stretch; margin-bottom:24px; }
    .hero-main { padding:28px; border:1px solid var(--line); border-radius:8px; background:var(--panel); }
    .eyebrow { margin:0 0 8px; color:var(--muted); text-transform:uppercase; letter-spacing:.08em; font-size:12px; font-weight:700; }
    h1 { margin:0; font-size:34px; line-height:1.12; letter-spacing:0; }
    .lead { max-width:820px; margin:14px 0 0; color:var(--muted); font-size:16px; }
    .hero-side { display:grid; gap:10px; }
    .metric { padding:16px; border:1px solid var(--line); border-radius:8px; background:var(--panel); }
    .metric span { display:block; color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.06em; font-weight:700; }
    .metric strong { display:block; margin-top:4px; font-size:28px; line-height:1; }
    .metric em { display:block; margin-top:6px; color:var(--muted); font-style:normal; font-size:13px; }
    .section { margin-top:26px; }
    .section-head { display:flex; justify-content:space-between; gap:16px; align-items:end; margin-bottom:12px; }
    h2 { margin:0; font-size:24px; letter-spacing:0; }
    h3 { margin:0; font-size:18px; letter-spacing:0; }
    .section-note { margin:4px 0 0; color:var(--muted); }
    .grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
    .card, .panel, .doc { border:1px solid var(--line); border-radius:8px; background:var(--panel); }
    .card { padding:16px; }
    .card.red { border-color:#efbbb7; background:var(--red-bg); }
    .card.amber { border-color:#ead090; background:var(--amber-bg); }
    .card.neutral { border-color:var(--line); }
    .card-top { display:flex; justify-content:space-between; gap:12px; align-items:start; }
    .label { color:var(--muted); font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; }
    .count { display:inline-flex; gap:5px; align-items:baseline; padding:4px 9px; border:1px solid currentColor; border-radius:999px; color:var(--blue); background:#fff; font-size:12px; }
    .count strong { font-size:15px; }
    .card p { margin:10px 0 0; color:#34362f; }
    .examples { display:flex; gap:6px; flex-wrap:wrap; margin-top:12px; color:var(--muted); font-size:13px; }
    .examples a { color:var(--blue); }
    .filters { display:flex; gap:10px; flex-wrap:wrap; padding:14px; border-bottom:1px solid var(--line); }
    .search { flex:1 1 360px; min-height:42px; padding:8px 12px; border:1px solid #c9c0b2; border-radius:7px; background:white; color:var(--ink); font:inherit; }
    .filter-buttons { display:flex; gap:8px; flex-wrap:wrap; }
    .filter-btn { min-height:38px; padding:7px 12px; border:1px solid var(--line); border-radius:7px; background:white; color:var(--ink); font:inherit; cursor:pointer; }
    .filter-btn.active { background:var(--ink); color:white; border-color:var(--ink); }
    .table-wrap { overflow:auto; }
    table { width:100%; border-collapse:collapse; }
    th, td { padding:13px 14px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
    th { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.06em; background:#faf7f1; }
    tbody tr:hover { background:#fbf8f1; }
    .pill { display:inline-flex; align-items:center; justify-content:center; min-width:40px; padding:3px 8px; border-radius:7px; font-weight:700; font-size:12px; }
    .sev-p0, .sev-p1 { color:var(--red); background:#ffe9e7; border:1px solid #efbbb7; }
    .sev-p2 { color:var(--amber); background:#fff4cc; border:1px solid #e6cb80; }
    .sev-p3 { color:var(--green); background:var(--green-bg); border:1px solid #bad9c4; }
    .subline { margin-top:4px; color:var(--muted); font-size:12px; }
    .tags { display:flex; flex-wrap:wrap; gap:5px; }
    .tag { display:inline-flex; padding:2px 7px; border-radius:999px; background:#f0ebe3; color:#4d5148; font-size:12px; }
    .file-links { display:flex; flex-wrap:wrap; gap:7px; }
    .file-links a { display:inline-flex; padding:3px 7px; border:1px solid var(--line); border-radius:6px; background:#fff; text-decoration:none; font-size:13px; }
    .doc { padding:26px; }
    .doc h2, .doc h3, .doc h4, .doc h5 { margin:22px 0 8px; }
    .doc p { margin:9px 0; }
    .doc ul { margin:8px 0 14px; padding-left:22px; }
    .table-scroll { overflow:auto; margin:12px 0; border:1px solid var(--line); border-radius:8px; }
    .table-scroll table { min-width:760px; }
    .raw-source { margin-top:24px; }
    .hidden { display:none; }
    @media (max-width:900px) { .page { padding:18px 14px 36px; } .hero { grid-template-columns:1fr; } .grid { grid-template-columns:1fr; } h1 { font-size:28px; } th, td { padding:11px 10px; } }
  </style>
</head>
<body>
  <main class="page">
    <nav class="top-nav">${nav}</nav>
    <header class="hero">
      <div class="hero-main">
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h1>${escapeHtml(title)}</h1>
      </div>
      <aside class="hero-side"></aside>
    </header>
    ${body}
  </main>
</body>
</html>`
}

function renderDocPage({ doc, type, allDocs, pairedDoc }) {
  const htmlPath = htmlFileFor(doc, type === 'trace' ? TRACE_HTML_DIR : AUDIT_HTML_DIR)
  const index = allDocs.findIndex((candidate) => candidate.name === doc.name)
  const prev = allDocs[index - 1]
  const next = allDocs[index + 1]
  const sourceDir = type === 'trace' ? TRACE_DIR : AUDIT_DIR
  const title = type === 'trace' ? `追踪：${doc.base}` : `审计：${doc.base}`
  const chatId = extractField(doc.markdown, 'Chat id') || chatIdFromName(doc.name)
  const resolution = RESOLVED_AUDITS[chatId]
  const resolutionBanner = resolution
    ? `<aside class="card neutral" style="margin-bottom:16px;">
        <div class="card-top"><div><div class="label">已修复历史样本</div><h3>已修复 / 历史回归样本</h3></div><span class="tag">${escapeHtml(resolution.fixedAt)}</span></div>
        <p>${escapeHtml(resolution.note)}</p>
        <p><strong>提交：</strong><code>${escapeHtml(resolution.commit)}</code></p>
      </aside>`
    : ''
  const navLinks = [
    { label: '总入口', href: relative(htmlPath, STABLE_DASHBOARD) },
    prev && { label: '上一篇', href: relative(htmlPath, htmlFileFor(prev, type === 'trace' ? TRACE_HTML_DIR : AUDIT_HTML_DIR)) },
    next && { label: '下一篇', href: relative(htmlPath, htmlFileFor(next, type === 'trace' ? TRACE_HTML_DIR : AUDIT_HTML_DIR)) },
    pairedDoc && {
      label: type === 'trace' ? '对应审计' : '对应追踪',
      href: relative(htmlPath, htmlFileFor(pairedDoc, type === 'trace' ? AUDIT_HTML_DIR : TRACE_HTML_DIR)),
    },
    { label: '原始 Markdown', href: relative(htmlPath, path.join(sourceDir, doc.name)) },
  ]
  const body = `<section class="doc">
    ${resolutionBanner}
    ${renderMarkdown(doc.markdown)}
    <details class="raw-source">
      <summary>查看原始 Markdown</summary>
      <pre><code>${escapeHtml(doc.markdown)}</code></pre>
    </details>
  </section>`
  return pageChrome({
    title,
    eyebrow: type === 'trace' ? '生产聊天追踪详情' : '生产聊天审计详情',
    navLinks,
    body,
  }).replace('<aside class="hero-side"></aside>', `<aside class="hero-side">
        <div class="metric"><span>文件</span><strong>${escapeHtml(doc.name)}</strong><em>${type === 'trace' ? '原始追踪' : '审计'}</em></div>
        <div class="metric"><span>聊天</span><strong>${escapeHtml(chatId)}</strong><em>${escapeHtml(extractField(doc.markdown, 'Case id') || '无 case id 字段')}</em></div>
      </aside>`)
}

function buildModels() {
  const traces = readMarkdownFiles(TRACE_DIR)
  const audits = readMarkdownFiles(AUDIT_DIR)
  const traceByName = new Map(traces.map((trace) => [trace.name, trace]))
  const traceByChat = new Map()
  for (const trace of traces) {
    const chatId = chatIdFromName(trace.name)
    if (!traceByChat.has(chatId)) traceByChat.set(chatId, trace)
  }

  const auditModels = audits.map((audit) => {
    const severity = extractField(audit.markdown, 'Overall severity') || 'P3'
    const chatId = extractField(audit.markdown, 'Chat id') || chatIdFromName(audit.name)
    const caseId = extractField(audit.markdown, 'Case id')
    const sourceTrace = sourceTraceName(audit.markdown) || `production-chat-trace-${audit.name}`
    const trace = traceByName.get(sourceTrace) || traceByChat.get(chatId)
    const evidence = firstParagraph(extractSection(audit.markdown, ['证据摘要', 'Evidence Summary', '运行快照'])) || firstParagraph(audit.markdown)
    const recommendation =
      firstParagraph(extractSection(audit.markdown, ['Recommended Next Action', '建议动作', '建议修复', 'Recommendation'])) ||
      '请阅读单案 audit，补充推荐下一步。'
    const issueText = stripMarkdown(
      [
        extractSection(audit.markdown, ['问题', 'Problems', 'Issues']),
        extractSection(audit.markdown, ['产品优化点', 'Product Optimizations']),
        extractSection(audit.markdown, ['疑似根因', 'Suspected Root Cause']),
        extractSection(audit.markdown, ['影响面', 'Affected Surface']),
        recommendation,
        evidence,
      ].join('\n'),
    )
    const categories = categorize(issueText)
    const observedAt = traceUpdatedAt(trace)
    const resolution = RESOLVED_AUDITS[chatId]
    return {
      ...audit,
      severity,
      chatId,
      caseId,
      sourceTrace,
      trace,
      keyFinding: stripMarkdown(evidence).slice(0, 420),
      recommendation: stripMarkdown(recommendation).slice(0, 520),
      categories,
      traceUpdatedAt: observedAt.label,
      traceUpdatedAtMs: observedAt.ms,
      resolution,
      resolved: Boolean(resolution),
    }
  })

  const auditedTraceNames = new Set(auditModels.map((audit) => audit.sourceTrace).filter(Boolean))
  const rawWithoutAudit = traces.filter((trace) => !auditedTraceNames.has(trace.name))
  return { traces, audits, auditModels, rawWithoutAudit }
}

function renderCategoryCards(auditModels) {
  return CATEGORY_DEFINITIONS.map((category) => {
    const matching = auditModels.filter((audit) => audit.categories.includes(category.id))
    const examples = matching
      .filter((audit) => !audit.resolved)
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.name.localeCompare(b.name))
      .slice(0, 4)
      .map((audit) => {
        const auditHtml = path.join(AUDIT_HTML_DIR, `${audit.base}.html`)
        return `<a href="${escapeAttr(relative(STABLE_DASHBOARD, auditHtml))}">${escapeHtml(audit.chatId)}</a>`
      })
      .join('<span>·</span>')
    return `<article class="card ${category.tone}" id="${escapeAttr(category.id)}">
      <div class="card-top">
        <div><div class="label">${escapeHtml(category.label)}</div><h3>${escapeHtml(category.title)}</h3></div>
        <button class="count" data-filter-category="${escapeAttr(category.id)}" type="button"><strong>${matching.length}</strong><span>案例</span></button>
      </div>
      <p><strong>问题：</strong>${inlineMarkdown(category.problem)}</p>
      <p><strong>解决：</strong>${inlineMarkdown(category.solution)}</p>
      <p><strong>验收：</strong>${inlineMarkdown(category.acceptance)}</p>
      <div class="examples"><span>样例：</span>${examples || '<span>暂无</span>'}</div>
    </article>`
  }).join('\n')
}

function renderPriorityCards(auditModels) {
  return auditModels
    .filter((audit) => ['P0', 'P1'].includes(audit.severity) && !audit.resolved)
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.mtimeMs - a.mtimeMs)
    .slice(0, 8)
    .map((audit) => {
      const auditHref = relative(STABLE_DASHBOARD, path.join(AUDIT_HTML_DIR, `${audit.base}.html`))
      const traceHref = audit.trace ? relative(STABLE_DASHBOARD, htmlFileFor(audit.trace, TRACE_HTML_DIR)) : ''
      return `<article class="card ${audit.severity === 'P0' ? 'red' : 'amber'}">
        <div class="card-top">
          <span class="pill sev-${escapeAttr(audit.severity.toLowerCase())}">${escapeHtml(audit.severity)}</span>
          <div class="file-links"><a href="${escapeAttr(auditHref)}">${escapeHtml(audit.chatId)}</a>${traceHref ? `<a href="${escapeAttr(traceHref)}">追踪</a>` : ''}</div>
        </div>
        <h3>${escapeHtml(audit.keyFinding.slice(0, 96) || audit.name)}</h3>
        <p><strong>推荐修法：</strong>${inlineMarkdown(audit.recommendation.slice(0, 260))}</p>
      </article>`
    })
    .join('\n')
}

function renderAuditRows(auditModels) {
  return auditModels
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.name.localeCompare(b.name))
    .map((audit) => {
      const auditHref = relative(STABLE_DASHBOARD, path.join(AUDIT_HTML_DIR, `${audit.base}.html`))
      const traceHref = audit.trace ? relative(STABLE_DASHBOARD, htmlFileFor(audit.trace, TRACE_HTML_DIR)) : ''
      const sourceHref = relative(STABLE_DASHBOARD, path.join(AUDIT_DIR, audit.name))
      const rawHref = audit.trace ? relative(STABLE_DASHBOARD, path.join(TRACE_DIR, audit.trace.name)) : ''
      const categories = audit.categories.length ? audit.categories : ['uncategorized']
      const search = stripMarkdown([
        audit.name,
        audit.chatId,
        audit.caseId,
        audit.keyFinding,
        audit.recommendation,
        categories.join(' '),
        categories.map(categoryLabel).join(' '),
      ].join(' '))
      const resolutionBadge = audit.resolution
        ? `<div class="subline"><span class="tag">已修复 / 历史样本</span> 修复于 ${escapeHtml(audit.resolution.fixedAt)} · <code>${escapeHtml(audit.resolution.commit)}</code></div>`
        : ''
      const recommendation = audit.resolution
        ? `<p><strong>已修复：</strong>${escapeHtml(audit.resolution.note)}</p><p><strong>原建议：</strong>${inlineMarkdown(audit.recommendation)}</p>`
        : inlineMarkdown(audit.recommendation)
      return `<tr data-severity="${escapeAttr(audit.severity)}" data-categories="${escapeAttr(categories.join(' '))}" data-search="${escapeAttr(search.toLowerCase())}">
        <td><span class="pill sev-${escapeAttr(audit.severity.toLowerCase())}">${escapeHtml(audit.severity)}</span></td>
        <td><a href="${escapeAttr(auditHref)}">${escapeHtml(audit.chatId)}</a><div class="subline">${escapeHtml(audit.caseId || audit.name)}</div>${resolutionBadge}</td>
        <td>${inlineMarkdown(audit.keyFinding || '未提取到摘要。')}</td>
        <td><div class="tags">${categories.map((category) => `<span class="tag">${escapeHtml(categoryLabel(category))}</span>`).join('')}</div></td>
        <td>${recommendation}</td>
        <td><div class="file-links"><a href="${escapeAttr(auditHref)}">审计页</a>${traceHref ? `<a href="${escapeAttr(traceHref)}">追踪页</a>` : ''}<a href="${escapeAttr(sourceHref)}">审计 Markdown</a>${rawHref ? `<a href="${escapeAttr(rawHref)}">追踪 Markdown</a>` : ''}</div></td>
      </tr>`
    })
    .join('\n')
}

function renderTraceRows(traces, auditModels) {
  const auditByTrace = new Map(auditModels.filter((audit) => audit.trace).map((audit) => [audit.trace.name, audit]))
  return traces
    .slice()
    .sort((a, b) => b.name.localeCompare(a.name))
    .map((trace) => {
      const audit = auditByTrace.get(trace.name)
      const traceHref = relative(STABLE_DASHBOARD, htmlFileFor(trace, TRACE_HTML_DIR))
      const auditHref = audit ? relative(STABLE_DASHBOARD, htmlFileFor(audit, AUDIT_HTML_DIR)) : ''
      const mdHref = relative(STABLE_DASHBOARD, path.join(TRACE_DIR, trace.name))
      const chatId = chatIdFromName(trace.name)
      const summary = stripMarkdown(firstParagraph(extractSection(trace.markdown, ['Summary', '摘要', '问题摘要'])) || firstParagraph(trace.markdown)).slice(0, 260)
      const search = stripMarkdown([trace.name, chatId, summary, audit?.severity ?? '未审计'].join(' ')).toLowerCase()
      return `<tr data-search="${escapeAttr(search)}">
        <td><a href="${escapeAttr(traceHref)}">${escapeHtml(chatId)}</a><div class="subline">${escapeHtml(trace.name)}</div></td>
        <td>${inlineMarkdown(summary || '打开追踪详情查看完整动作时间线。')}</td>
        <td>${audit ? `<span class="pill sev-${escapeAttr(audit.severity.toLowerCase())}">${escapeHtml(audit.severity)}</span>` : '<span class="tag">未审计</span>'}</td>
        <td><div class="file-links"><a href="${escapeAttr(traceHref)}">追踪页</a>${auditHref ? `<a href="${escapeAttr(auditHref)}">审计页</a>` : ''}<a href="${escapeAttr(mdHref)}">追踪 Markdown</a></div></td>
      </tr>`
    })
    .join('\n')
}

function textMatchesWatch(text, watch) {
  if (!watch?.groups?.length) return false
  const lower = String(text ?? '').toLowerCase()
  return watch.groups.every((group) => group.some((keyword) => lower.includes(String(keyword).toLowerCase())))
}

function fixMarkerHits(marker, auditModels) {
  if (!marker.watch || !marker.since) return []
  const sinceMs = Date.parse(marker.since)
  if (!sinceMs) return []
  return auditModels
    .filter((audit) => audit.traceUpdatedAtMs && audit.traceUpdatedAtMs >= sinceMs)
    .filter((audit) => textMatchesWatch([
      audit.name,
      audit.chatId,
      audit.keyFinding,
      audit.recommendation,
      audit.markdown,
      audit.trace?.markdown ?? '',
    ].join('\n'), marker.watch))
    .sort((a, b) => (b.traceUpdatedAtMs || 0) - (a.traceUpdatedAtMs || 0))
}

function renderFixWatch(marker, auditModels) {
  if (!marker.watch) return ''
  const hits = fixMarkerHits(marker, auditModels)
  const examples = hits.slice(0, 4).map((audit) => {
    const auditHref = relative(STABLE_DASHBOARD, path.join(AUDIT_HTML_DIR, `${audit.base}.html`))
    const at = audit.traceUpdatedAt ? ` · ${audit.traceUpdatedAt}` : ''
    return `<a href="${escapeAttr(auditHref)}">${escapeHtml(audit.chatId)}${escapeHtml(at)}</a>`
  }).join('<span>·</span>')
  return `<p><strong>自动化观察：</strong>${escapeHtml(marker.watch.label)}，marker 后候选命中 <strong>${hits.length}</strong> 个。${examples ? `<span class="examples">${examples}</span>` : '<span class="subline">当前没有 marker 后复现候选。</span>'}</p>`
}

function renderFixMarkers(auditModels) {
  return FIX_MARKERS
    .map((marker) => `<article class="card neutral">
      <div class="card-top">
        <div><div class="label">修复标记</div><h3>${escapeHtml(marker.title)}</h3></div>
        <span class="tag">${escapeHtml(marker.time)}</span>
      </div>
      <p><strong>基线：</strong>${escapeHtml(marker.scope)}</p>
      <p><strong>提交：</strong><code>${escapeHtml(marker.commit)}</code></p>
      <p><strong>观察口径：</strong>${escapeHtml(marker.note)}</p>
      ${renderFixWatch(marker, auditModels)}
    </article>`)
    .join('\n')
}

function renderDashboard({ traces, auditModels, rawWithoutAudit }) {
  const activeSeverityCounts = auditModels.filter((audit) => !audit.resolved).reduce((acc, audit) => {
    acc[audit.severity] = (acc[audit.severity] ?? 0) + 1
    return acc
  }, {})
  const fixedHighSeverityCount = auditModels.filter((audit) => audit.resolved && ['P0', 'P1'].includes(audit.severity)).length
  const body = `
    <section class="section">
      <div class="section-head"><div><h2>修复观察备注</h2><p class="section-note">用于区分历史样本和修复后新复现；后续自动化刷新总入口时会保留这些基线。</p></div></div>
      <div class="grid">${renderFixMarkers(auditModels)}</div>
    </section>

    <section class="section">
      <div class="section-head"><div><h2>全局问题地图</h2><p class="section-note">按工程主题聚合所有单案审计；点击案例数字可过滤完整案例表。</p></div></div>
      <div class="grid">${renderCategoryCards(auditModels)}</div>
    </section>

    <section class="section">
      <div class="section-head"><div><h2>P0/P1 优先样例</h2><p class="section-note">自动从当前审计提取；已修复历史案例不再进入当前优先级列表。</p></div></div>
      <div class="grid">${renderPriorityCards(auditModels)}</div>
    </section>

    <section class="section">
      <div class="section-head"><div><h2 id="audit-table-title">完整案例表</h2><p class="section-note">搜索聊天 ID、case id、文件名、问题描述或解决方案；所有链接优先进入 HTML 详情页。</p></div></div>
      <div class="panel">
        <div class="filters">
          <input id="auditSearch" class="search" type="search" placeholder="搜索审计、原始追踪、聊天 ID、问题、下一步...">
          <div class="filter-buttons">
            <button class="filter-btn active" data-filter-severity="all" type="button">全部</button>
            <button class="filter-btn" data-filter-severity="P0" type="button">P0</button>
            <button class="filter-btn" data-filter-severity="P1" type="button">P1</button>
            <button class="filter-btn" data-filter-severity="P2" type="button">P2</button>
            <button class="filter-btn" data-filter-severity="P3" type="button">P3</button>
          </div>
        </div>
        <div class="table-wrap"><table><thead><tr><th>严重度</th><th>案例</th><th>核心发现</th><th>分类</th><th>建议下一步</th><th>文件</th></tr></thead><tbody id="auditRows">${renderAuditRows(auditModels)}</tbody></table></div>
        <div class="subline" id="auditVisibleCount" style="padding:12px 14px;"></div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><div><h2>追踪 HTML 导航</h2><p class="section-note">这里是全部原始追踪的 HTML 入口；已审计追踪会显示对应审计严重度和链接。</p></div></div>
      <div class="panel">
        <div class="filters"><input id="traceSearch" class="search" type="search" placeholder="搜索追踪页、聊天 ID、摘要、审计状态..."></div>
        <div class="table-wrap"><table><thead><tr><th>追踪</th><th>摘要</th><th>审计</th><th>文件</th></tr></thead><tbody id="traceRows">${renderTraceRows(traces, auditModels)}</tbody></table></div>
        <div class="subline" id="traceVisibleCount" style="padding:12px 14px;"></div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><div><h2>原始追踪未审计差异</h2><p class="section-note">审计文件 ${auditModels.length} 份，原始追踪 ${traces.length} 份。这里单独列出原始追踪已产出但还没有对应审计的项。</p></div></div>
      <div class="panel" style="padding:16px;">
        ${
          rawWithoutAudit.length
            ? `<ul>${rawWithoutAudit
                .map((trace) => `<li><a href="${escapeAttr(relative(STABLE_DASHBOARD, htmlFileFor(trace, TRACE_HTML_DIR)))}">${escapeHtml(trace.name)}</a></li>`)
                .join('')}</ul>`
            : '<p>没有未审计原始追踪。</p>'
        }
      </div>
    </section>

    <script>
      const auditSearch = document.getElementById('auditSearch')
      const traceSearch = document.getElementById('traceSearch')
      const auditRows = Array.from(document.querySelectorAll('#auditRows tr'))
      const traceRows = Array.from(document.querySelectorAll('#traceRows tr'))
      const auditCount = document.getElementById('auditVisibleCount')
      const traceCount = document.getElementById('traceVisibleCount')
      let severityFilter = 'all'
      let categoryFilter = ''

      function renderAuditRows() {
        const query = (auditSearch.value || '').trim().toLowerCase()
        let visible = 0
        for (const row of auditRows) {
          const severityOk = severityFilter === 'all' || row.dataset.severity === severityFilter
          const categoryOk = !categoryFilter || (row.dataset.categories || '').split(' ').includes(categoryFilter)
          const searchOk = !query || (row.dataset.search || '').includes(query)
          const show = severityOk && categoryOk && searchOk
          row.classList.toggle('hidden', !show)
          if (show) visible += 1
        }
        auditCount.textContent = visible + ' / ' + auditRows.length + ' 个案例可见'
      }

      function renderTraceRows() {
        const query = (traceSearch.value || '').trim().toLowerCase()
        let visible = 0
        for (const row of traceRows) {
          const show = !query || (row.dataset.search || '').includes(query)
          row.classList.toggle('hidden', !show)
          if (show) visible += 1
        }
        traceCount.textContent = visible + ' / ' + traceRows.length + ' 个追踪可见'
      }

      document.querySelectorAll('[data-filter-severity]').forEach((button) => {
        button.addEventListener('click', () => {
          severityFilter = button.dataset.filterSeverity
          categoryFilter = ''
          document.querySelectorAll('[data-filter-severity]').forEach((candidate) => candidate.classList.toggle('active', candidate === button))
          renderAuditRows()
          document.getElementById('audit-table-title').scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      })
      document.querySelectorAll('[data-filter-category]').forEach((button) => {
        button.addEventListener('click', () => {
          categoryFilter = button.dataset.filterCategory
          severityFilter = 'all'
          document.querySelectorAll('[data-filter-severity]').forEach((candidate) => candidate.classList.toggle('active', candidate.dataset.filterSeverity === 'all'))
          renderAuditRows()
          document.getElementById('audit-table-title').scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      })
      auditSearch.addEventListener('input', renderAuditRows)
      traceSearch.addEventListener('input', renderTraceRows)
      renderAuditRows()
      renderTraceRows()
    </script>`

  return pageChrome({
    title: '生产聊天追踪 / 审计总入口看板',
    eyebrow: '唯一入口 / 全局问题地图 / HTML 下钻',
    navLinks: [
      { label: '全局问题地图', href: '#audit-table-title' },
      { label: '审计 Markdown 目录', href: relative(STABLE_DASHBOARD, AUDIT_DIR) },
      { label: '追踪 Markdown 目录', href: relative(STABLE_DASHBOARD, TRACE_DIR) },
    ],
    body,
  }).replace('<aside class="hero-side"></aside>', `<aside class="hero-side">
        <div class="metric"><span>审计文件</span><strong>${auditModels.length}</strong><em>不含 README / INDEX</em></div>
        <div class="metric"><span>原始追踪</span><strong>${traces.length}</strong><em>每份都有 HTML 下钻</em></div>
        <div class="metric"><span>当前 P0 / P1</span><strong>${activeSeverityCounts.P0 ?? 0} / ${activeSeverityCounts.P1 ?? 0}</strong><em>${fixedHighSeverityCount} 个已修复高优先级样本保留为回归样本</em></div>
        <div class="metric"><span>未审计原始追踪</span><strong>${rawWithoutAudit.length}</strong><em>审计自动化下一轮处理</em></div>
      </aside>`)
}

function writeHtmlFiles({ traces, audits, auditModels }) {
  ensureDir(REPORT_DIR)
  ensureDir(TRACE_HTML_DIR)
  ensureDir(AUDIT_HTML_DIR)

  const auditByTraceName = new Map(auditModels.filter((audit) => audit.trace).map((audit) => [audit.trace.name, audit]))
  const traceBySource = new Map(traces.map((trace) => [trace.name, trace]))

  for (const trace of traces) {
    const pairedAudit = auditByTraceName.get(trace.name)
    fs.writeFileSync(htmlFileFor(trace, TRACE_HTML_DIR), renderDocPage({ doc: trace, type: 'trace', allDocs: traces, pairedDoc: pairedAudit }))
  }

  for (const audit of audits) {
    const source = sourceTraceName(audit.markdown)
    const chatId = extractField(audit.markdown, 'Chat id') || chatIdFromName(audit.name)
    const pairedTrace = traceBySource.get(source) || traces.find((trace) => chatIdFromName(trace.name) === chatId)
    fs.writeFileSync(htmlFileFor(audit, AUDIT_HTML_DIR), renderDocPage({ doc: audit, type: 'audit', allDocs: audits, pairedDoc: pairedTrace }))
  }
}

function validateLinks(filePath) {
  const html = fs.readFileSync(filePath, 'utf8')
  const links = [...html.matchAll(/href="([^"#][^"]*)"/g)]
    .map((match) => match[1])
    .filter((href) => !/^(https?:|mailto:|data:)/.test(href))
  return links.filter((href) => !fs.existsSync(path.resolve(path.dirname(filePath), href)))
}

function main() {
  const model = buildModels()
  writeHtmlFiles(model)
  const dashboard = renderDashboard(model)
  fs.writeFileSync(STABLE_DASHBOARD, dashboard)
  fs.writeFileSync(DAILY_DASHBOARD, dashboard)

  const missing = [...validateLinks(STABLE_DASHBOARD), ...validateLinks(DAILY_DASHBOARD)]
  if (missing.length) {
    console.error(`看板生成完成，但有 ${missing.length} 个链接缺失：`)
    for (const link of missing.slice(0, 20)) console.error(`- ${link}`)
    process.exit(1)
  }

  console.log(`已生成 ${path.relative(ROOT, STABLE_DASHBOARD)}`)
  console.log(`已生成 ${path.relative(ROOT, DAILY_DASHBOARD)}`)
  console.log(`追踪 HTML 页面：${model.traces.length}`)
  console.log(`审计 HTML 页面：${model.audits.length}`)
  console.log(`未审计原始追踪：${model.rawWithoutAudit.length}`)
}

main()
