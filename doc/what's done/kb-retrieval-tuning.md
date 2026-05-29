# KB 检索质量优化指导（GPTBots vector/match）

> 目标读者：开发同学。基于 **2026-05-28 对线上 `api` 客户真实知识库的实测**，给出可直接落地的代码级修复方案。
> 一句话结论：**当前线上 7 个知识源全部没有启用 rerank，导致召回分数塌缩、相关切片被埋；而 GPTBots 在 rerank 开启后返回的 list 又不按 score 排序。两个问题叠加 = "评分都很高、原话排到 10 名外"。**

---

## 0. TL;DR — 按优先级落地

| 优先级 | 动作 | 文件 | 风险 |
|--------|------|------|------|
| **P0** | 收到 `vector/match` 响应后，对 `list` 按 `score` 降序重排再返回 | `apps/chat/lib/agent/streaming-tool-executor.ts:408` | 极低，纯排序 |
| **P0** | 把所有 KnowledgeSource 的 `rerankVersion` 从 `null`/`Jina` 改成 **`BGE-Rerank`**（含线上 DB 行，非只改 seed） | DB + `packages/shared/defaults/index.ts:1088` | 低，需回归测试 |
| **P1** | 默认 `topK` 5 → **15~20**（给 rerank 足够候选池；20~50 切片的源不再被截断） | `packages/shared/defaults/index.ts` + `skills.ts:756` | 低 |
| **P1** | `docCorrelation` 0.5 → **0.3 或更低 / 留空**（阈值在压缩分数上不稳定，可能误杀全部结果） | DB + `defaults/index.ts` | 低 |
| **P2** | 修数据建模：每个源现在=单文档，所有切片共享同一个 `data_id`，`[KB:data_id]` 引用无法定位具体切片 | GPTBots 知识库侧（重新切分/拆文档） | 需 KB owner 配合 |
| **P2** | 不要把 `embedding_rate`/`doc_correlation` 暴露给 agent（见 §6）；只保留 `query` + `topK` | `skills.ts` / prompt | — |

> **P0 的两条必须一起上**：没有 BGE，分数会塌缩成全部相等（实测 Promotion 整页 12 条全是 `0.2970`），此时重排也无意义；开了 BGE 才有区分度的分数，但 GPTBots 返回的 list 不按它排序，所以必须再重排。缺一不可。

---

## 1. 背景：当前检索链路

每个启用的 `KnowledgeSource` 被动态注入为一个 `kb_search_<name>` 工具（`apps/chat/lib/agent/skills.ts:747`），agent 可并行调用（`isConcurrencySafe: true`）。实际请求体在 `executeHttp` 里拼装，会把 DB 里该源的 `groupIds / embeddingRate / rerankVersion / docCorrelation` 合进去（`apps/chat/lib/agent/streaming-tool-executor.ts:366-373`），打到：

```
POST https://api-sg.gptbots.ai/v1/vector/match
```

API 参数规格见 `doc/知识库/向量相似度匹配.md`。关键参数：

- `embedding_rate` ∈ [0,1]，默认 1。**1=纯语义，0=纯关键词**，0.4=关键词40%+语义60%。
- `rerank_version`：可选 `BGE-Rerank` / `Jina-reranker-v2-base-multilingual` / `Jina-colbert-v2` / `BCE-Rerank`。
- `doc_correlation` ∈ [0.1,0.95]：相关性阈值，官方文档明确警告"过高可能导致无可用知识块"。
- 响应：`{ total, list: [{ content, data_id, score, document_name }] }`。

---

## 2. 线上配置快照（customer `api`，实测于 2026-05-28）

| 源 | 切片数 | distinct data_id | embedding_rate | rerank | doc_correlation | topK |
|----|-------:|-----------------:|---------------:|--------|----------------:|-----:|
| Abbreviation Mapping | 1 | 1 | 0.9 | **null** | 0.5 | 5 |
| Account | 21 | 1 | 0.7 | **null** | 0.5 | 5 |
| Deposit | 8 | 1 | 0.7 | **null** | 0.5 | 5 |
| Game | 6 | 1 | 0.7 | **null** | 0.5 | 5 |
| General | 22 | 1 | 0.7 | **null** | 0.5 | 5 |
| Promotion | 50+ | 4 | 0.7 | **null** | 0.5 | 5 |
| Withdraw | 16 | 1 | 0.8 | **null** | 0.5 | 5 |

**两个立刻能看出的问题：**
1. `rerank` 全部为 `null`（注意：`seed`/`defaults` 里写的是 Jina，但线上 DB 行是 null——**seed 与 DB 已漂移**，改 seed 不会改到线上，必须直接 update DB 行）。
2. 除 Promotion 外，每个源只有 **1 个 data_id**（整个源是一篇大 QA 文档切片）→ `[KB:data_id]` 引用标签无法区分到底引的是哪一条。

---

## 3. 实测证据（决定性）

> 测试脚本见 §7，可复现。以下为真实输出节选。

### 3.1 不开 rerank → 分数塌缩（复现"评分都很高/都一样"）

源 `Promotion`，query=`how to claim my deposit bonus`，top_k=12，rerank=OFF：

```
#1 0.2970 Sportsbook:Salami Rain ...
#2 0.2970 Special:Salami Rain ...
...
#12 0.2970 Welcome Bonus:Salami Rain ...   ← 全部 12 条 score 完全相等 = 0.2970
```

全部并列 `0.2970`，**零区分度**，且排在前面的全是无关的 "Salami Rain" 活动，真正的 Welcome Bonus 答案进不了可用位置。源 `Deposit` 同理（全部挤在 0.6083~0.6254，spread 仅 0.017）。

### 3.2 `Jina` = 空操作，`BGE` 才真正重排

源 `Account`，query=`how to verify my account`，跑两遍结果完全一致（确定性）：

```
rerank=undefined  scores=[0.939,0.914,0.905,0.867,0.262,0.262]
rerank=Jina-v2    scores=[0.939,0.914,0.905,0.867,0.262,0.262]   ← 与不开完全相同
rerank=BGE-Rerank scores=[0.914,0.905,0.939,0.627,0.867,0.630]   ← 顺序与分数都变了
rerank=INVALID    scores=[0.939,0.914,0.905,0.867,0.262,0.262]   ← 非法值被静默忽略
```

**结论：seed 默认的 `Jina-reranker-v2-base-multilingual` 在本 endpoint 上等于没开。只有 `BGE-Rerank` 实际生效。**（建议也 A/B 一下 `Jina-colbert-v2` / `BCE-Rerank`。）

### 3.3 开了 BGE，list 却不按 score 排序（复现"原话排到 10 名外"）

源 `Promotion`，query=`welcome bonus terms`，top_k=20，rerank=`BGE-Rerank`，**API 返回的原始顺序**：

```
pos 1  score=0.2297  [无关活动切片]          ← 被排在第 1
pos 2  score=0.8681  ...
pos 3  score=0.8454  ...
pos 4  score=0.9375  Welcome Bonus:99% ...    ← 最相关的，却在第 4
pos 5  score=0.9184  Welcome Bonus:288% ...
pos 8  score=0.8753  Promotion/Bonus for Welcome Bonus ...
monotonic-descending by score? false
```

最相关的切片（0.9375）被排在第 4，前面压着一个 0.2297 的无关切片。**这就是"原话排到 10 名外"的真身**：不是检索没召回到，而是 API 把它召回了、给了高分、但没排到前面，而 harness 直接按原始顺序取用。

### 3.4 重排修复后（BGE + 客户端按 score 降序）

同一 query 重排后 top-6：

```
#1 0.9375 Welcome Bonus:99% Welcome 9 Wicket Bonus
#2 0.9319 Crash Game:288% Slot and Fast Game Welcome Bonus
#3 0.9192 Slot Game:30% Weekly Slot Reload Bonus
#4 0.9184 Welcome Bonus:288% Slot and Fast Game Welcome Bonus
#5 0.9164 Slot Game:288% Slot and Fast Game Welcome Bonus
#6 0.8753 Promotion/Bonus for Welcome Bonus
```

干净、全部相关。**这就是 P0 两条改动叠加后的效果。**

### 3.5 embedding_rate 不影响排序（只缩放分数）

源 `Account`，2 个 query，er=0.3/0.7/1.0 → **顺序完全相同**，只有绝对分数变化。源 `Deposit` 同样（er 0.3→1.0，顺序不变，分数 0.27→0.89）。

**结论：在本 endpoint 上 `embedding_rate` 不是排序/相关性杠杆，只是分数量级旋钮。** （官方文档说它调关键词/语义权重；实测没改排序，推测是关键词索引贡献很弱或候选切片关键词重合度一致。）

### 3.6 doc_correlation 阈值不稳定

源 `Promotion`，固定阈值 0.5，随 embedding_rate 变化，30 条候选里"存活"数量：

```
er=0.3 → 23 条存活 ;  er=0.5 → 12 ;  er=0.7 → 17 ;  er=0.9 → 19
```

非单调、波动大。因为 `score` 量级被 `embedding_rate` 缩放、又叠加塌缩，**固定 0.5 阈值在不同 er/query 下含义完全不同，可能误杀全部或放过噪声。**

---

## 4. 根因总结

1. **没开有效的 rerank** → 纯向量召回分数塌缩（切片间差 0.001~0.01），排序近似随机。
2. **配的 rerank（Jina-v2）在 vector/match 上是空操作**，且线上 DB 干脆是 `null`。
3. **rerank 开启后 GPTBots 不按 score 排序返回**，harness 又按原始顺序取用 → 高相关切片被埋。
4. `topK=5` 在 20~50 切片的源上会截断真正的候选。
5. `docCorrelation=0.5` 在塌缩/缩放的分数上是不稳定的相关性闸门。
6. （数据侧）每源单 data_id → 引用无法定位切片。

---

## 5. 代码级修复

### P0-a：响应按 score 降序重排 — `streaming-tool-executor.ts`

`executeHttp` 当前直接 `return response.json()`（`apps/chat/lib/agent/streaming-tool-executor.ts:408`）。改为对 KB 工具的响应重排（并可选裁剪到展示 topN）：

```ts
// streaming-tool-executor.ts —— 替换第 408 行 `return response.json()`
const data = await response.json()

// GPTBots 在开启 rerank 后返回的 list 不按 score 排序（实测见 doc/to-do/kb-retrieval-tuning.md §3.3）。
// 必须按 score 降序重排，否则最相关切片会被埋在无关切片之后。
if (
  (definition.name === 'kb_hybrid_retrieve' || definition.name.startsWith('kb_search_')) &&
  data && Array.isArray(data.list)
) {
  data.list.sort((a: { score?: number }, b: { score?: number }) => (b.score ?? 0) - (a.score ?? 0))
}
return data
```

> 注意：不开 rerank 时 list 本来就是降序的，这步是幂等的、无副作用。`livechat` carousel 渲染（`renderHints.itemsField: '$.list'`）也会同步受益。

### P0-b：启用 BGE-Rerank（seed + 线上 DB 都要改）

**seed 默认**（`packages/shared/defaults/index.ts:1088-1162`，每个源）：

```ts
// 把：
rerankVersion: 'Jina-reranker-v2-base-multilingual',
// 改成：
rerankVersion: 'BGE-Rerank',
```

**线上 DB（关键，否则不生效）** —— customer `api`（以及 `default`）的现有 7 行 `rerankVersion` 是 `null`，seed 不会覆盖已存在的行。需要一次性 update，例如：

```sql
UPDATE "KnowledgeSource"
SET "rerankVersion" = 'BGE-Rerank'
WHERE "customerId" IN ('api','default') AND "enabled" = true;
```

或在 console 知识库页（`apps/console/app/admin/knowledge/page.tsx`，已有 reranker 下拉）逐源选 BGE 保存。

### P1-a：提高默认 topK（候选池）

- DB / seed：把各源 `topK` 由 5 提到 **15~20**（Promotion 50+、Account/General ~20 的源尤其需要）。
- agent 看到的 inputSchema 默认值（`apps/chat/lib/agent/skills.ts:756` `default: 5`）建议同步提到 10~15，让 agent 不显式传时也有足够候选。
- 注意：实测 rerank 分数会随候选池大小变化（top_k=12 时 ~0.76，top_k=20 时 ~0.92），**所以不要对 rerank 分数做跨调用的硬阈值**，它只在单次调用内做相对排序可信。

### P1-b：放松 docCorrelation

把各源 `docCorrelation` 由 0.5 降到 **0.3 或留空**，改为依赖「BGE 重排 + 按 score 降序 + 取 topN」来保证质量，而不是用一个在塌缩分数上不稳定的全局阈值做硬过滤。若要保留阈值，应按各源实测分布分别设定，而非一刀切 0.5。

### P2-a：数据建模（引用定位）

每个源现在是单篇大文档（单 data_id），`[KB:data_id]` 引用无法定位具体切片（prompt 里要求用该标签做可审计引用，见 `packages/shared/defaults/index.ts:654` 附近）。建议 KB owner 侧把大 QA 文档按主题拆成多文档，或在切片层引入可引用的 chunk id。**纯代码侧无法解决。**

### P2-b：embedding_rate 代码小瑕疵（低优先）

`streaming-tool-executor.ts:358` 的 `avgEmbeddingRate = s.embeddingRate` 命名为"平均"实则被最后一个源覆盖（仅影响 `kb_hybrid_retrieve` 多源路径；单源 `kb_search_*` 无影响）。`kb-hybrid-retrieve.ts:80` 同样。鉴于 embedding_rate 不是排序杠杆，影响很小，顺手修即可。

---

## 6. 关于"把检索参数暴露给 agent，让它换召回策略"

原始想法：一轮 retrieve 不满意时，让 intera 调检索参数换策略。**基于实测，结论是不要暴露数值型检索参数：**

- `embedding_rate`：实测不改排序（§3.5），暴露给模型无收益，反而增加 token 与选错值的概率。
- `doc_correlation`：全局阈值，且不稳定（§3.6），不适合按轮次让模型乱调。
- 唯一对 agent 有意义的杠杆是 **`topK`（已暴露）+ query 改写**。"换策略重试"的正确形态是：模型用同义词/拆解/翻译重写 query 再搜一遍 + 调大 topK，这两件它现在就能做。

**建议**：保持工具 inputSchema 为 `{ query, topK }`，并在 prompt 里补一句重试指引，例如："若首轮检索结果相关度低或为空，请用不同措辞/关键词重写 query 再检索一次，或调大 topK。" 真正的相关性提升靠服务端的 rerank + 重排（§5），不靠把旋钮交给模型。

---

## 7. 复现/验证脚本

> 放在仓库根目录用 `node script.mjs` 跑（Node 24）。从 DB 读取 GPTBots key，**不打印密钥**。改 `CUSTOMER`/源名/query 即可。

```js
import { readFileSync } from 'node:fs'
const ROOT = process.cwd()
process.env.DATABASE_URL = readFileSync(`${ROOT}/.env.local`, 'utf8')
  .match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1]
const { PrismaClient } = await import(`${ROOT}/node_modules/@prisma/client/index.js`)
const prisma = new PrismaClient()
const API = 'https://api-sg.gptbots.ai/v1/vector/match'

const CUSTOMER = 'api'
const KEY = (await prisma.agentConfig.findUnique({
  where: { customerId: CUSTOMER }, select: { gptbotsApiKey: true },
})).gptbotsApiKey
const sources = await prisma.knowledgeSource.findMany({ where: { customerId: CUSTOMER, enabled: true } })
await prisma.$disconnect()

const G = JSON.parse(sources.find(s => s.name === 'Promotion').groupIds)
const snip = s => (s || '').replace(/\s+/g, ' ').slice(0, 46)

async function search({ prompt, top_k = 20, embedding_rate = 0.7, rerank, doc_correlation = 0.1 }) {
  const body = { prompt, top_k, group_ids: G, embedding_rate, doc_correlation }
  if (rerank) body.rerank_version = rerank
  const r = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await r.json()).list ?? []
}

const Q = 'welcome bonus terms'
const off = await search({ prompt: Q })                          // 当前线上：无 rerank
const bge = await search({ prompt: Q, rerank: 'BGE-Rerank' })    // 修复后：BGE
const fixed = [...bge].sort((a, b) => b.score - a.score)         // + 客户端按 score 降序

const show = (label, list) => {
  console.log(`\n== ${label} ==`)
  list.slice(0, 6).forEach((it, i) => console.log(`  #${i + 1} ${it.score.toFixed(4)} ${snip(it.content)}`))
}
show('当前线上（无 rerank，原始顺序）', off)
show('仅 BGE（API 原始顺序，未重排）', bge)
show('BGE + 按 score 降序（目标效果）', fixed)
process.exit(0)
```

---

## 8. 验收标准（给改完之后）

1. 用一组人工标注的"问题→应命中文档"金标准（建议每个源 5~10 条，目前仓库没有，需新建），对比改前/改后命中切片是否进入 top-3。
2. 重点验证 §3.3 那类被埋 case：相关切片应排到前列。
3. 注意本次只测了 `vector/match` 这一个 endpoint（harness 实际用的就是它）；若 GPTBots 还有更高层的 RAG/answer 接口，行为可能不同，不在本次结论范围内。
4. 没有金标准前，"BGE 比不开好"是基于少量 query 的人工判断（§3.4 干净、§3.3 修复），不是统计指标——上线前请补一个小评测集量化。
