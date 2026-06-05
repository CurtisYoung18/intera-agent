# RenderHints Warm Craft Design

> Playground 工具渲染卡片 + Thinking 框重新设计

## Overview

将 Playground 中所有 RenderHintCard 渲染类型和 Thinking 折叠框从当前的冷色 inline-style 风格，重新设计为温暖手工质感（Warm Craft），参考 Notion / Craft 的纸质美学。

**Scope**: 仅 Playground 渠道，不涉及 livechat / web-chat。

## Design Direction

温暖手工风 — 纸质质感、暖色色调、有温度的排版。

### Design Tokens

```css
/* Colors */
--wc-bg: #f5f0eb;              /* 页面底色 — 暖灰 */
--wc-surface: #fffcf9;          /* 卡片底色 — 暖白 */
--wc-surface-hover: #faf8f5;    /* 输入框/悬浮底色 */
--wc-text: #3d3833;             /* 主文字 — 深棕 */
--wc-text-secondary: #8a7e74;   /* 副文字 — 暖灰 */
--wc-text-muted: #b8a99a;       /* 弱文字 — 浅暖灰 */
--wc-accent: #d4764e;           /* 主强调色 — 陶土/琥珀 */
--wc-accent-hover: #c9884a;     /* 强调色 hover */
--wc-primary: #3d3833;          /* 主按钮底色 — 深棕 */
--wc-border: rgba(0,0,0,0.06);  /* 边框 */
--wc-shadow: rgba(60,40,20,0.04); /* 暖色阴影 */

/* Typography */
--wc-font-sans: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
--wc-font-serif: 'Literata', Georgia, serif;
--wc-font-mono: 'SF Mono', 'Fira Code', monospace;

/* Spacing */
--wc-radius: 16px;   /* 卡片圆角 */
--wc-radius-sm: 10px; /* 输入框/按钮圆角 */
--wc-radius-xs: 8px;  /* 标签/小元素圆角 */
```

### Typography Rules

| Element | Font | Size | Weight | Color | Notes |
|---------|------|------|--------|-------|-------|
| Card Title | DM Sans | 17px | 700 | #2d2926 | letter-spacing -0.01em |
| Card Subtitle | DM Sans | 13.5px | 400 | #8a7e74 | line-height 1.55 |
| Form Label | DM Sans | 12px | 600 | #8a7e74 | letter-spacing 0.02em |
| Input Text | DM Sans | 14px | 400 | #3d3833 | |
| Button | DM Sans | 14px | 600 | inherit | |
| Thinking Label | DM Sans | 13px | 600 | #b87347 | 渐变或纯色均可 |
| Thinking Content | Literata | 14px | 400 italic | #6b5e54 | line-height 1.8 |
| List Item | DM Sans | 14px | 400 | #3d3833 | |
| Code | SF Mono | 13px | 400 | #5a524b | |
| Quote | Literata | 14px | 400 italic | #8a7e74 | line-height 1.65 |

### Interaction Rules

- **Hover**: `translateY(-1px)` + 暖色投影加深
- **Active**: `translateY(0)`, transition-duration 缩短到 0.1s
- **Focus**: `border-color: #c9a87c` + `box-shadow: 0 0 0 3px rgba(201,168,124,0.12)`
- **Transition**: `cubic-bezier(0.16,1,0.3,1)` for transforms, `ease` for colors
- **No glassmorphism**, no backdrop-filter, no gradient backgrounds on cards
- **Paper texture**: SVG feTurbulence noise overlay on body (opacity 0.03)

---

## Component Specs

### 1. Thinking Box

**容器**:
- 圆角 16px, 背景 `#fffcf9`, 边框 `1px solid rgba(0,0,0,0.06)`
- 无 glassmorphism，纯纸质卡片

**Header (可点击)**:
- 左侧: SVG 箭头 icon (18x18, color `#b8a99a`, 展开时 rotate 90deg)
- 中间: "Thinking" 标签 (13px, 600, color `#b87347`)
- 右侧: 脉动圆点 (7x7, background `#d4764e`, opacity 0.3-0.8 循环)
- Hover: 背景 `rgba(0,0,0,0.015)`

**Body (展开)**:
- 分割线: `height: 1px`, 渐变 `transparent → rgba(0,0,0,0.06) → transparent`
- 内容: Literata 衬线斜体, 14px, color `#6b5e54`, line-height 1.8
- 展开动画: max-height 0→400px, cubic-bezier(0.4,0,0.2,1)

**与当前实现的差异**:
- ~~serif italic 难读~~ → Literata 字体专门优化阅读，行高从 1.7 提升到 1.8
- ~~原生 `<details>` 三角~~ → 自定义 SVG 箭头 + 旋转动画
- ~~`rgba(139,111,245,0.04)` 冷紫背景~~ → `#fffcf9` 暖白纸质
- ~~`var(--lavender)` 紫色标签~~ → 陶土色 `#b87347`

### 2. Form

**容器**: 同 Thinking 外层卡片样式

**字段**:
- Label: 12px, 600, `#8a7e74`, 必填星号 `#d4764e`
- Input/Select/Textarea: padding 11px 14px, 圆角 10px, 背景 `#faf8f5`, 边框 `1.5px solid rgba(0,0,0,0.08)`
- Focus: border `#c9a87c`, 光圈 `rgba(201,168,124,0.12)`
- Placeholder: `#c4b8ab`

**复选框**:
- 18x18, 圆角 5px, 选中后深棕底 + 白色 ✓

**提交按钮**:
- 陶土渐变 `linear-gradient(135deg, #d4764e, #c9884a)`, 白色文字
- 或深棕实心 `#3d3833`
- 圆角 10px, padding 11px 24px

### 3. Card

- Title: 17px, 700, `#2d2926`
- Subtitle: 13.5px, 400, `#8a7e74`
- 按钮组: ghost + primary 并排

### 4. List

- 编号: 24x24 圆角方块, 背景 `rgba(212,118,78,0.08)`, 文字 `#b87347`
- 无编号: 6px 圆点, `#d4764e`, opacity 0.5
- 分割线: `rgba(0,0,0,0.04)`
- Hover: `rgba(0,0,0,0.015)`

### 5. Plain / Code / Quote

- Plain: 14px, `#5a524b`, line-height 1.6
- Code: SF Mono 13px, 背景 `#f5f0eb`, 边框 `rgba(0,0,0,0.05)`, 圆角 12px
- Quote: 左边框 3px `#d4764e`, Literata 斜体, `#8a7e74`

### 6. Quick Replies

- 胶囊按钮: 圆角 999px, padding 8px 18px
- 背景 `#faf8f5`, 边框 `1.5px solid rgba(0,0,0,0.06)`, 文字 `#6b5e54`
- Hover: 背景 `#f0ebe5`, translateY(-1px)

---

## File Changes

### New / Modified

| File | Change |
|------|--------|
| `apps/console/components/chat/render-hint-card.tsx` | 替换全部 inline styles 为 Warm Craft tokens；所有 5 种 renderhint 类型 + thinking box |
| `apps/console/app/admin/playground/page.tsx` | Thinking 折叠框替换为新设计（lines 853-878） |

### NOT Changed

- `packages/shared/channels/render-hints.ts` — 类型定义不变
- `apps/console/components/playground/trace-sidebar.tsx` — 消费逻辑不变
- livechat / web-chat 渠道 — 不受影响

## Implementation Notes

- 所有样式仍然用 inline React.CSSProperties（保持项目现有模式）
- 需要加载 Google Fonts: DM Sans + Literata（通过 `@import` 或 `<link>`）
- SVG 噪点纹理用 data URI 内联
- Thinking box 从 `<details>/<summary>` 改为受控 `<div>` + onClick 状态管理
- 需要保留现有的 `onSubmit`、`hint.kind` 分支逻辑不变
