> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# KB 检索质量优化（GPTBots vector/match）

> **来源**: `kb-retrieval-tuning.md`（保持原文结构，精炼关键信息）
> **结论**: 线上 7 个知识源全部未启用 rerank → 召回分数塌缩、相关切片被埋。GPTBots 开启 rerank 后返回的 list 不按 score 排序。两个问题叠加 → "评分都很高、原话排到 10 名外"。

---

## TL;DR 修复优先级

| 优先级 | 动作 | 文件 | 风险 |
|--------|------|------|------|
| **P0** | 收到 `vector/match` 响应后，对 `list` 按 `score` 降序重排 | `streaming-tool-executor.ts:408` | 极低 |
| **P0** | 所有 KnowledgeSource 的 `rerankVersion` → `BGE-Rerank`（线上 DB 也改） | DB + `defaults/index.ts:1088` | 低 |
| **P1** | 默认 `topK` 5 → 15~20 | `defaults/index.ts` + `skills.ts:756` | 低 |
| **P1** | `docCorrelation` 0.5 → 0.3 或留空 | DB + defaults | 低 |
| **P2** | 每源单 data_id → 引用无法定位切片 | GPTBots 知识库侧 | 需 KB owner |
| **P2** | 不要把 `embedding_rate`/`doc_correlation` 暴露给 agent | skills.ts / prompt | — |

> P0 两条必须一起上：无 BGE → 分数全相等 → 重排无意义；开了 BGE 但 GPTBots 不排序 → 必须客户端重排。

---

## 线上配置现状（vendor `api`，实测 05-28）

| 源 | 切片数 | rerank | doc_correlation | topK |
|----|-------:|--------|----------------:|-----:|
| Abbreviation | 1 | **null** | 0.5 | 5 |
| Account | 21 | **null** | 0.5 | 5 |
| Deposit | 8 | **null** | 0.5 | 5 |
| Game | 6 | **null** | 0.5 | 5 |
| General | 22 | **null** | 0.5 | 5 |
| Promotion | 50+ | **null** | 0.5 | 5 |
| Withdraw | 16 | **null** | 0.5 | 5 |

两个即时问题：(1) `rerank` 全部 `null`（seed 写 Jina 但 DB 已漂移）；(2) 除 Promotion 外每源仅 1 个 data_id。

---

## 实测证据

### 不开 rerank → 分数塌缩
源 Promotion，query=`how to claim my deposit bonus`，top_k=12：全部 12 条 score = `0.2970`，零区分度。

### Jina = 空操作，BGE 才真正生效
同一 query，BGE-Rerank 改变了顺序和分数；Jina-v2 结果与不开完全相同。

### 开了 BGE 但 list 不按 score 排序
最相关切片（score 0.9375）排在第 4，前面压着 0.2297 的无关切片。重排后 top-6 全部相关。

### embedding_rate 不影响排序
实测 0.3/0.7/1.0 → 顺序完全相同，只改分数量级。不要把此参数当杠杆暴露给 agent。

---

## 代码级修复

**P0-a**: `streaming-tool-executor.ts:408` — 对 KB 工具响应按 score 降序重排。

**P0-b**: seed 默认改为 `BGE-Rerank` + 线上 DB 一次性 update：`UPDATE "KnowledgeSource" SET "rerankVersion" = 'BGE-Rerank' WHERE "customerId" IN ('api','default') AND "enabled" = true;`

**P1-a**: 提高默认 topK（给 rerank 足够候选池）。注意 rerank 分数随候选池变化，不要做跨调用硬阈值。

**P1-b**: 放松 docCorrelation，依赖"BGE 重排 + 按 score 降序 + 取 topN"保证质量。

---

## 对 agent 的建议

不暴露数值型检索参数（embedding_rate、doc_correlation）。唯一有意义的杠杆是 `query 改写 + topK`。在 prompt 中加一句："若首轮检索相关度低，请用不同措辞重写 query 再检索，或调大 topK。"

---

## 验收

1. 人工标注金标准（每源 5-10 条），对比改前/改后命中切片是否进 top-3
2. 重点验证"被埋"类 case：相关切片应排到前列
3. 上线前补小评测集量化提升
