# To-Do: 退休 DashboardReader，全面切换 MessageBus

> **决策**：DashboardReader 的轮询机制已被 MessageBus 的 push/poll 替代。保留 `bumpDashboardVersion()` 用于 CaseMemory 写入路径。
>
> **对齐 CC**：CC 的 sub-agent 无轮询机制，上下文由主 Agent dispatch 时注入 task prompt。Intera 的 MessageBus 在此基础上更进一步——支持运行中通知。

## 为什么退休

| | MessageBus | DashboardReader |
|---|---|---|
| 机制 | push → poll（消息入队，下轮消费） | 每轮读 `dashboardVersion` |
| 延迟 | 一个迭代 | 一个迭代 |
| 携带内容 | 任意消息体 | 只有版本号，需再调 `getDashboardDiff()` 拿内容 |
| CPU 开销 | 无（数组 push/shift） | 每轮一次内存读 + 条件分支 + `getDashboardDiff()` 遍历 changelog |

MessageBus 已接入 `runReActLoop()`（每轮迭代前 poll）， DashboardReader 的轮询路径（`sub-agent.ts` 中的 `[DASHBOARD UPDATE]` 代码块）成为死代码。

## 改造范围

| 文件 | 改动 |
|------|------|
| `sub-agent.ts` | 移除 constructor 中的 `dashboardReader?: DashboardReader` 参数。移除 `investigateStreaming()` 中的 Dashboard 轮询代码块（约 50 行）。移除 `DashboardReader` 导入 |
| `orchestrator.ts` | 移除 `task.context.dashboardReader = this.memoryManager` |
| `types/index.ts` | 检查 `DashboardReader` 接口是否还有其他引用。若无，移除。`DashboardChange` 接口同时移除 |
| `memory.ts` | **保留** `bumpDashboardVersion()` 和 `getDashboardVersion()`——CaseMemory 写入路径仍需要版本号 |

## 验证

- [ ] Sub-Agent 执行时不再出现 `[DASHBOARD UPDATE — version X]` 日志
- [ ] 主 Agent 消费并发消息 → MessageBus.send('*') → Sub-Agent 下轮 `poll()` 收到 → 行为调整生效
- [ ] typecheck + build 通过
