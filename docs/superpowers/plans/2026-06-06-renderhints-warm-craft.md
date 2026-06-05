# RenderHints Warm Craft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign all RenderHintCard types and the Thinking box in the Playground to use a warm, handcrafted visual style (Warm Craft) — replacing cold indigo/lavender with warm paper textures, earthy tones, and better typography.

**Architecture:** Two files change: `render-hint-card.tsx` gets new inline styles for all 5 renderhint types + quick_replies; `playground/page.tsx` gets a new Thinking component replacing the `<details>` element. No type changes, no new files, no backend changes.

**Tech Stack:** React (inline styles), Google Fonts (DM Sans + Literata), Lucide React icons

---

### Task 1: RenderHintCard — Replace styles object

**Files:**
- Modify: `apps/console/components/chat/render-hint-card.tsx:26-199`

This is a pure style overhaul. The component structure, props, and branching logic stay identical — only the `styles` object values change.

- [ ] **Step 1: Run existing tests to confirm they pass**

```bash
cd /Users/curtis/Desktop/intera-agent && npx vitest run apps/console/components/chat/__tests__/render-hint-card.test.tsx
```

Expected: All 20 tests PASS.

- [ ] **Step 2: Replace the styles object with Warm Craft tokens**

Replace the entire `styles` object (lines 26–199) in `apps/console/components/chat/render-hint-card.tsx` with:

```typescript
const styles = {
  card: {
    padding: '24px',
    borderRadius: 16,
    background: '#fffcf9',
    border: '1px solid rgba(0,0,0,0.06)',
    boxShadow: '0 1px 2px rgba(60,40,20,0.04), 0 4px 12px rgba(60,40,20,0.03)',
    position: 'relative',
    overflow: 'hidden',
  } as React.CSSProperties,
  cardTitle: {
    fontSize: 17,
    fontWeight: 700,
    letterSpacing: '-0.01em',
    color: '#2d2926',
    marginBottom: 4,
    fontFamily: "var(--wc-font-sans, 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif)",
  } as React.CSSProperties,
  cardSubtitle: {
    fontSize: 13.5,
    fontWeight: 400,
    color: '#8a7e74',
    marginBottom: 4,
    lineHeight: 1.55,
    fontFamily: "var(--wc-font-sans, 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif)",
  } as React.CSSProperties,
  cardImage: {
    width: '100%',
    maxWidth: 280,
    borderRadius: 12,
    marginBottom: 4,
    display: 'block',
  } as React.CSSProperties,
  buttonRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  } as React.CSSProperties,
  button: {
    padding: '9px 20px',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    border: '1.5px solid rgba(0,0,0,0.08)',
    background: 'transparent',
    color: '#8a7e74',
    cursor: 'pointer',
    fontFamily: "var(--wc-font-sans, 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif)",
    transition: 'all 0.25s ease',
  } as React.CSSProperties,
  buttonPrimary: {
    padding: '9px 20px',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    border: 'none',
    background: '#3d3833',
    color: '#fffcf9',
    cursor: 'pointer',
    boxShadow: '0 1px 2px rgba(60,40,20,0.15)',
    fontFamily: "var(--wc-font-sans, 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif)",
    transition: 'all 0.25s ease',
  } as React.CSSProperties,
  buttonDanger: {
    padding: '9px 20px',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    border: '1.5px solid rgba(212,118,78,0.2)',
    background: 'rgba(212,118,78,0.06)',
    color: '#b87347',
    cursor: 'pointer',
    fontFamily: "var(--wc-font-sans, 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif)",
    transition: 'all 0.25s ease',
  } as React.CSSProperties,
  pill: {
    padding: '7px 16px',
    borderRadius: 999,
    background: '#faf8f5',
    border: '1.5px solid rgba(0,0,0,0.06)',
    fontSize: 13,
    fontWeight: 500,
    color: '#6b5e54',
    fontFamily: "var(--wc-font-sans, 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif)",
  } as React.CSSProperties,
  formField: {
    marginBottom: 14,
  } as React.CSSProperties,
  formLabel: {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: '#8a7e74',
    marginBottom: 6,
    letterSpacing: '0.02em',
    fontFamily: "var(--wc-font-sans, 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif)",
  } as React.CSSProperties,
  formInput: {
    width: '100%',
    padding: '11px 14px',
    borderRadius: 10,
    border: '1.5px solid rgba(0,0,0,0.08)',
    background: '#faf8f5',
    fontSize: 14,
    color: '#3d3833',
    outline: 'none',
    boxSizing: 'border-box' as const,
    fontFamily: "var(--wc-font-sans, 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif)",
    transition: 'all 0.25s ease',
  },
  formSelect: {
    width: '100%',
    padding: '11px 14px',
    borderRadius: 10,
    border: '1.5px solid rgba(0,0,0,0.08)',
    background: '#faf8f5',
    fontSize: 14,
    color: '#3d3833',
    outline: 'none',
    boxSizing: 'border-box' as const,
    fontFamily: "var(--wc-font-sans, 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif)",
    transition: 'all 0.25s ease',
    appearance: 'none' as const,
    cursor: 'pointer',
  },
  formTextarea: {
    width: '100%',
    padding: '11px 14px',
    borderRadius: 10,
    border: '1.5px solid rgba(0,0,0,0.08)',
    background: '#faf8f5',
    fontSize: 14,
    color: '#3d3833',
    outline: 'none',
    minHeight: 80,
    resize: 'vertical' as const,
    boxSizing: 'border-box' as const,
    fontFamily: "var(--wc-font-sans, 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif)",
    transition: 'all 0.25s ease',
  },
  submitButton: {
    padding: '11px 28px',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    border: 'none',
    background: 'linear-gradient(135deg, #d4764e, #c9884a)',
    color: '#fff',
    cursor: 'pointer',
    marginTop: 8,
    fontFamily: "var(--wc-font-sans, 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif)",
    boxShadow: '0 1px 2px rgba(212,118,78,0.25)',
    transition: 'all 0.25s ease',
  } as React.CSSProperties,
  blockquote: {
    borderLeft: '3px solid #d4764e',
    paddingLeft: 16,
    paddingTop: 12,
    paddingBottom: 12,
    margin: 0,
    fontSize: 14,
    fontFamily: "var(--wc-font-serif, 'Literata', Georgia, serif)",
    fontStyle: 'italic' as const,
    color: '#8a7e74',
    lineHeight: 1.65,
  } as React.CSSProperties,
  pre: {
    padding: '16px 18px',
    borderRadius: 12,
    background: '#f5f0eb',
    border: '1px solid rgba(0,0,0,0.05)',
    fontSize: 13,
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    color: '#5a524b',
    overflowX: 'auto' as const,
    whiteSpace: 'pre-wrap' as const,
    lineHeight: 1.6,
  } as React.CSSProperties,
  list: {
    paddingLeft: 0,
    margin: 0,
    listStyle: 'none',
    fontSize: 14,
    color: '#3d3833',
  } as React.CSSProperties,
  listItem: {
    padding: '12px 18px',
    borderBottom: '1px solid rgba(0,0,0,0.04)',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  } as React.CSSProperties,
  plainText: {
    fontSize: 14,
    color: '#5a524b',
    whiteSpace: 'pre-wrap' as const,
    lineHeight: 1.6,
    fontFamily: "var(--wc-font-sans, 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif)",
  } as React.CSSProperties,
  imageDisplay: {
    maxWidth: '100%',
    borderRadius: 12,
    display: 'block',
  } as React.CSSProperties,
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  } as React.CSSProperties,
  checkboxLabel: {
    fontSize: 13.5,
    color: '#5a524b',
    fontFamily: "var(--wc-font-sans, 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif)",
  } as React.CSSProperties,
  listItemNum: {
    width: 24,
    height: 24,
    borderRadius: 8,
    background: 'rgba(212,118,78,0.08)',
    color: '#b87347',
    fontSize: 12,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  } as React.CSSProperties,
  listItemDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#d4764e',
    opacity: 0.5,
    flexShrink: 0,
  } as React.CSSProperties,
}
```

- [ ] **Step 3: Update list rendering to use numbered/dot styles**

In the `hint.kind === 'list'` branch, the current code uses native `<ul>/<ol>` with `paddingLeft: 18`. Replace with the new structure.

Find the indexed list block (around line 379-389):

```typescript
// BEFORE:
if (hint.showIndex) {
  return (
    <ol style={styles.list}>
      {items.map((item, i) => (
        <li key={i} style={styles.listItem}>
          {typeof item === 'string' ? item : String(item.label ?? item.title ?? item)}
        </li>
      ))}
    </ol>
  )
}

return (
  <ul style={styles.list}>
    {items.map((item, i) => (
      <li key={i} style={styles.listItem}>
        {typeof item === 'string' ? item : String(item.label ?? item.title ?? item)}
      </li>
    ))}
  </ul>
)
```

Replace with:

```typescript
// AFTER:
if (hint.showIndex) {
  return (
    <div style={styles.list}>
      {items.map((item, i) => (
        <div key={i} style={styles.listItem}>
          <span style={styles.listItemNum}>{i + 1}</span>
          <span>{typeof item === 'string' ? item : String(item.label ?? item.title ?? item)}</span>
        </div>
      ))}
    </div>
  )
}

return (
  <div style={styles.list}>
    {items.map((item, i) => (
      <div key={i} style={styles.listItem}>
        <span style={styles.listItemDot} />
        <span>{typeof item === 'string' ? item : String(item.label ?? item.title ?? item)}</span>
      </div>
    ))}
  </div>
)
```

- [ ] **Step 4: Run existing tests**

```bash
cd /Users/curtis/Desktop/intera-agent && npx vitest run apps/console/components/chat/__tests__/render-hint-card.test.tsx
```

Expected: Some tests may FAIL because they check for `<ul` / `<ol` tags which are now `<div>`. Update the tests in the next step.

- [ ] **Step 5: Update tests for new list structure**

Replace the list tests in `apps/console/components/chat/__tests__/render-hint-card.test.tsx` (lines 173-207):

```typescript
describe('list hint', () => {
  it('renders bulleted list by default', () => {
    const hint: RenderHint = { kind: 'list' }
    const result = { items: ['First', 'Second', 'Third'] }
    const html = renderToString(
      RenderHintCard({ hint, result }),
    )
    expect(html).toContain('First')
    expect(html).toContain('Second')
    expect(html).toContain('Third')
    // New: uses div-based list with dot indicators
    const liCount = (html.match(/First|Second|Third/g) || []).length
    expect(liCount).toBe(3)
  })

  it('renders indexed list when showIndex is true', () => {
    const hint: RenderHint = { kind: 'list', showIndex: true }
    const result = { items: ['A', 'B'] }
    const html = renderToString(
      RenderHintCard({ hint, result }),
    )
    expect(html).toContain('A')
    expect(html).toContain('B')
    // Numbered indicators present
    expect(html).toContain('1')
    expect(html).toContain('2')
  })

  it('renders explicit bulleted list', () => {
    const hint: RenderHint = { kind: 'list', bulleted: true }
    const result = { items: ['X', 'Y'] }
    const html = renderToString(
      RenderHintCard({ hint, result }),
    )
    expect(html).toContain('X')
    expect(html).toContain('Y')
  })
})
```

- [ ] **Step 6: Run tests again**

```bash
cd /Users/curtis/Desktop/intera-agent && npx vitest run apps/console/components/chat/__tests__/render-hint-card.test.tsx
```

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/console/components/chat/render-hint-card.tsx apps/console/components/chat/__tests__/render-hint-card.test.tsx
git commit -m "feat(ui): warm craft redesign for RenderHintCard — paper texture, earthy tones, Literata/DM Sans typography"
```

---

### Task 2: Thinking Box — Replace `<details>` with controlled component

**Files:**
- Modify: `apps/console/app/admin/playground/page.tsx:871-893`

The Thinking box is currently a native `<details>/<summary>` element. Replace it with a controlled `<div>` that uses React state for expand/collapse, with the Warm Craft styling.

- [ ] **Step 1: Add thinkingOpen state**

In `apps/console/app/admin/playground/page.tsx`, find the state declarations near the top (around line 95). Add a new state for tracking which thinking blocks are open:

```typescript
// Add after existing state declarations (around line 95-96)
const [openThinkings, setOpenThinkings] = useState<Set<number>>(new Set())
```

- [ ] **Step 2: Replace the `<details>` block with new Thinking component**

Find the thinking block (lines 871-893):

```tsx
{showThinking && m.role === 'agent' && m.thinking && (
  <details style={{
    padding: '10px 14px', borderRadius: 12,
    marginBottom: 6,
    background: 'rgba(139,111,245,0.04)',
    border: '1px solid rgba(139,111,245,0.1)',
    fontSize: 12,
  }}>
    <summary style={{
      fontWeight: 600, color: 'var(--lavender)',
      cursor: 'pointer', marginBottom: 6,
    }}>
      Thinking
    </summary>
    <div style={{
      color: 'var(--mist)', lineHeight: 1.7,
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      fontFamily: 'var(--font-serif), serif', fontStyle: 'italic',
      fontSize: 12,
    }}>
      {m.thinking}
    </div>
  </details>
)}
```

Replace with:

```tsx
{showThinking && m.role === 'agent' && m.thinking && (() => {
  const isOpen = openThinkings.has(i)
  return (
    <div style={{
      borderRadius: 16,
      background: '#fffcf9',
      border: '1px solid rgba(0,0,0,0.06)',
      marginBottom: 6,
      boxShadow: '0 1px 2px rgba(60,40,20,0.04)',
      overflow: 'hidden',
      fontFamily: "var(--wc-font-sans, 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif)",
    }}>
      <div
        onClick={() => {
          setOpenThinkings(prev => {
            const next = new Set(prev)
            if (next.has(i)) next.delete(i)
            else next.add(i)
            return next
          })
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 18px', cursor: 'pointer',
          userSelect: 'none',
          transition: 'background 0.2s ease',
        }}
      >
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="#b8a99a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{
            transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
            transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
            flexShrink: 0,
          }}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        <span style={{
          fontSize: 13, fontWeight: 600,
          color: '#b87347',
          letterSpacing: '0.01em',
        }}>
          Thinking
        </span>
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: '#d4764e', opacity: 0.6,
          animation: 'wc-think-pulse 2.5s ease-in-out infinite',
        }} />
      </div>
      <div style={{
        maxHeight: isOpen ? 400 : 0,
        overflow: 'hidden',
        transition: 'max-height 0.4s cubic-bezier(0.4,0,0.2,1), padding 0.3s ease',
        padding: isOpen ? '0 18px 16px' : '0 18px',
      }}>
        <div style={{
          height: 1, marginBottom: 12,
          background: 'linear-gradient(90deg, transparent, rgba(0,0,0,0.06), transparent)',
        }} />
        <div style={{
          fontFamily: "var(--wc-font-serif, 'Literata', Georgia, serif)",
          fontSize: 14, fontStyle: 'italic',
          color: '#6b5e54', lineHeight: 1.8,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {m.thinking}
        </div>
      </div>
    </div>
  )
})()}
```

- [ ] **Step 3: Add the pulse keyframe animation**

Find the existing `<style>` tag or CSS-in-JS block in the playground page. If there's a global `<style>` tag for the page, add the keyframe there. Otherwise, add a `<style>` tag inside the return JSX (near the top of the rendered output):

```tsx
// Add inside the return JSX, before the main layout div:
<style>{`
  @keyframes wc-think-pulse {
    0%, 100% { opacity: 0.3; transform: scale(0.85); }
    50% { opacity: 0.8; transform: scale(1); }
  }
`}</style>
```

- [ ] **Step 4: Run playground tests**

```bash
cd /Users/curtis/Desktop/intera-agent && npx vitest run apps/console/app/admin/playground/
```

Expected: Tests pass (thinking box is visual-only, no logic tests to break).

- [ ] **Step 5: Manual verification**

Start the dev server and navigate to the playground:
1. Enable "Thinking" toggle in the toolbar
2. Send a message that triggers thinking
3. Verify: warm white card, SVG chevron rotates on click, Literata italic text, pulse dot animates
4. Verify: expand/collapse animation is smooth

- [ ] **Step 6: Commit**

```bash
git add apps/console/app/admin/playground/page.tsx
git commit -m "feat(ui): warm craft thinking box — paper card, Literata text, animated chevron"
```

---

### Task 3: Load Google Fonts

**Files:**
- Modify: `apps/console/app/layout.tsx` (or equivalent root layout)

The DM Sans and Literata fonts need to be loaded for the warm craft typography to render correctly.

- [ ] **Step 1: Check if fonts are already loaded**

```bash
grep -r "DM Sans\|Literata\|google.*fonts" /Users/curtis/Desktop/intera-agent/apps/console/app/layout.tsx
```

Expected: No matches (fonts not loaded yet).

- [ ] **Step 2: Add font imports to layout**

In `apps/console/app/layout.tsx`, add the Google Fonts import in the `<head>` or via Next.js `next/font`:

Option A — if using `<head>` in layout:

```tsx
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
<link
  href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,500;1,7..72,400&display=swap"
  rel="stylesheet"
/>
```

Option B — if using `next/font/google` (preferred):

```typescript
import { DM_Sans } from 'next/font/google'
import { Literata } from 'next/font/google'

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--wc-font-sans' })
const literata = Literata({ subsets: ['latin'], variable: '--wc-font-serif' })

// Then add `${dmSans.variable} ${literata.variable}` to the body className
```

- [ ] **Step 3: Run dev server and verify fonts load**

```bash
cd /Users/curtis/Desktop/intera-agent && npm run dev
```

Open browser DevTools → Network → check that DM Sans and Literata CSS files are loaded.

- [ ] **Step 4: Commit**

```bash
git add apps/console/app/layout.tsx
git commit -m "feat(ui): load DM Sans + Literata fonts for warm craft design system"
```

---

### Task 4: Final verification

- [ ] **Step 1: Run all tests**

```bash
cd /Users/curtis/Desktop/intera-agent && npx vitest run
```

Expected: All tests PASS.

- [ ] **Step 2: Visual check in playground**

1. Open playground in browser
2. Send a message — verify thinking box renders with warm craft style
3. Trigger a tool call — verify RenderHintCard renders form/card/list/etc. with new styles
4. Check: DM Sans renders for body text, Literata renders for thinking content and quotes
5. Check: hover states work on cards and buttons
6. Check: expand/collapse animation on thinking box is smooth

- [ ] **Step 3: Check that livechat / web-chat are unaffected**

Open the web-chat widget and livechat — verify their rendering has NOT changed (they use different code paths).
