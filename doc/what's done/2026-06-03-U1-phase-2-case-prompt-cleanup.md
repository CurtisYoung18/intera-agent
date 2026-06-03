# U1 Phase 2 · Case Prompt 切默认 base+append + 清退 legacy

**来源：** U1（Case Prompt swap → base+append）。Phase 1 已 shipped（见下"已完成核查"）。本文是**真正剩余**的 Phase 2 工作。
**风险：** 中（碰 prompt 装配默认值 + 既有配置迁移）。

---

## 已完成核查（2026-06-03，按代码核实，非 handoff）

| 项 | 状态 | 证据 |
|---|---|---|
| caseAddendum + useLegacyCasePrompt + migration | ✅ | [`schema.prisma:74-76`](../../packages/shared/prisma/schema.prisma:74) + 迁移 `20260603000007_add_case_addendum` |
| messages/route base+append 装配 | ✅ | `buildModePrompt` 已用 [`messages/route.ts:686`](../../apps/console/app/api/messages/route.ts:686) |
| UI 拆分 Base + Case Addendum | ✅ | [`agent/page.tsx:684`](../../apps/console/app/admin/agent/page.tsx:684) |
| Placeholder 归属拆分 | ✅ | 各 section 独立 placeholder 插入 |
| 向后兼容 flag | ✅ | `useLegacyCasePrompt` 默认 true，运行时遵循 |
| 子代理/orchestrator Phase 1 不动 | ✅ | 仍读 systemPrompt |

→ **结论：Phase 1 capability 全在；但默认仍走 legacy（`useLegacyCasePrompt=true`）。**

---

## Phase 2 剩余工作

1. **`CASE_SYSTEM_PROMPT` 标 @deprecated（不删）**：[`defaults/index.ts:91`](../../packages/shared/defaults/index.ts:91) 加 `@deprecated` 注释，指向 base+append。（schema 的 `systemPrompt` 列已标注 @deprecated。）
2. **翻转默认**：新建 `AgentConfig` 默认 `useLegacyCasePrompt=false`（base+append）。
3. **迁移既有配置**：把现存 `useLegacyCasePrompt=true` 且已填 `coreSystemPrompt`/`caseAddendum` 的版本切到 `false`；未填的提供一次性"从 systemPrompt 拆分到 core+addendum"的辅助或保留 legacy。需逐版本评估，**不可一刀切**（会改变线上行为）。
4. **（可选，更后）移除 legacy swap 路径**：确认无版本依赖 `systemPrompt` 后，删除 `systemPrompt` 列 + legacy 分支（schema:73 注 "Phase 2: remove"）。建议独立小迁移，单独验收。

---

## 验收

```bash
npx tsc --noEmit -p apps/console/tsconfig.json   # 0 errors
npm test                                          # 全绿
npm run build:console                             # success
```
- prompt 装配回归：legacy 与 base+append 两路输出符合预期（playground 对比）。
- 完成后移本文件到 `doc/what's done/`，更新 `MASTER_BUILD_HANDOFF.md`。
