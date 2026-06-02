# Fix docked-preview SWC compiler bug

**Priority:** Immediate | **Risk:** Low | **Deploy:** No (build only)

## Context

Next.js SWC compiler fails with "Unterminated string constant" when JSX `className` attributes span multiple lines. `docked-preview.tsx` has at least one such case.

## Bug location

`apps/console/components/docked-preview.tsx` — search for `className` strings that span two lines (i.e., the opening `"` and closing `"` are on different lines).

## Fix

Ensure every `className="..."` is on a **single line**. If a className is long, either:
- Keep it all on one line, or
- Use a template literal with `.trim()` + `.replace(/\s+/g, ' ')`

## Steps

1. Read `apps/console/components/docked-preview.tsx`
2. Find all multi-line `className` strings
3. Collapse them to single-line
4. Verify: `npm run build:console` — must succeed (this is the proof)
5. Verify: `npx tsc --noEmit -p apps/console/tsconfig.json` — 0 errors
6. Commit
