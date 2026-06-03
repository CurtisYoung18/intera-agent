# Playground 三 Bug 修复

**创建:** 2026-06-03 | **分支:** `main` @ `d1d5bf3`

## Bug A: 回复重复显示两次 ✅ 根因确认

**症状:** Playground 发第一条消息，Agent 回复在聊天区显示两次；发第二条后重复消失。

**根因:** `apps/console/app/admin/playground/page.tsx:269-271`
```typescript
// finally 块
setReply(r => {
  if (r) setChatMessages(prev => [...prev, { role: 'agent' as const, content: r }])
  return r  // ← BUG: 流式气泡残留
})
```

`reply` 不清空 → 流完成后 `chatMessages` 渲染一次（存档），`reply` 仍保留完整文本 → 流式气泡（line 518-542）再次渲染。

第二条消息时 `setReply('')` 清除了气泡，所以重复消失。

**修复:**
```
  return ''  // ← 清空流式气泡，已存档到 chatMessages
```

**验证:**
1. 打开 Playground 页面
2. 发送任意消息 → Agent 回复应只出现**一次**
3. 发送第二条消息 → 不应有残留内容

---

## Bug B: Behavior Trace 未跨消息保留 ✅ 根因确认

**症状:** 发送第二条消息后，第一条消息的 behavior trace 消失。

**根因 A:** `apps/console/app/admin/playground/page.tsx:198`
```typescript
setTraces([])  // ← 每轮清空所有历史 trace
```

**根因 B:** `apps/console/app/admin/playground/page.tsx:253-254`
```typescript
else if (event.type === 'trace') {
  const t = event.data.trace || []
  setTraces(t)  // ← 替换而非追加
}
```

**修复方案:** 按消息索引存储 trace，支持多轮累积。
```typescript
// 将 traces 状态改为按 turn 索引存储
const [traceByTurn, setTraceByTurn] = useState<Map<number, any[]>>(new Map())
// SSE 中追加到当前 turn，而非替换全局
```

**验证:**
1. 发送第一条消息 → trace 出现在侧边栏
2. 发送第二条消息 → 第一条的 trace **仍在**
3. 两条 trace 分别对应各自的 message index

---

## Bug C: Agent 管理面板按钮逻辑

**症状:** 生产环境看不到 Agent 卡片的删除/duplicate 等操作按钮。

**当前逻辑:** `apps/console/components/admin/agent-management-drawer.tsx:589`
- 删除按钮仅在 `group.versions.length > 1` 时显示（防止删除唯一版本）
- 入口：侧边栏底部 → 用户头像 → "Organization · Agent Name"

**待确认:** 用户是否需要：
1. 改变删除按钮的显示条件？
2. 把按钮放到更显眼的位置？
3. 其他 UI 调整？

---

## 验证流水线

```bash
# 代码类型检查
npx tsc --noEmit -p apps/console/tsconfig.json

# 运行测试（db-integration 失败是已知的 PostgreSQL 问题）
npm test

# 构建
npm run build:console

# 本地验证
npm run dev:console
# → 打开 http://localhost:3001/admin/playground
# → 按 Bug A/B 验证步骤检查
```
