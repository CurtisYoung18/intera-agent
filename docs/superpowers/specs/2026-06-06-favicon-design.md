# Intera Favicon Design Spec

**Date:** 2026-06-06
**Status:** Approved

## Overview

Design and implement a complete favicon set for the Intera console app. The current project has no favicon — this is a greenfield implementation.

## Design Direction

**Approach:** Gradient disc + bold sans-serif "I" (clarity-first variant)

The existing Intera logo uses a serif "I" inside a glassmorphic disc. For favicon, we simplify to maximize legibility at small sizes:

- **Gradient disc** — lavender to indigo linear gradient, no glass effects
- **Bold sans-serif "I"** — white, centered, thick strokes for 16px clarity
- **Transparent background** — works across light/dark browser chrome

## Visual Specification

### Gradient Disc
- **Shape:** Perfect circle, no border
- **Gradient:** `linear-gradient(150deg, #8b6ff5, #5b8af7)` (lavender → indigo)
- **No effects:** No blur, highlight, shadow, or glass morphism — pure gradient fill

### Letter "I"
- **Font:** Sans-serif, bold weight (700+), uniform stroke width
- **Color:** Pure white `#FFFFFF`
- **Proportions:** Letter height ≈ 55-60% of disc diameter; generous padding top/bottom
- **Stroke width:** ~6-7px at 32px scale, ensuring 16px legibility

## File Output

All files placed in `apps/console/public/`:

| File | Size | Format | Use Case |
|---|---|---|---|
| `favicon.svg` | Vector | SVG | Modern browsers (Chrome, Firefox, Edge) |
| `favicon-16.png` | 16×16 | PNG | Browser tab (small) |
| `favicon-32.png` | 32×32 | PNG | Browser tab (standard) |
| `favicon.ico` | 16+32+48 | ICO | Legacy browsers, bookmarks |
| `apple-touch-icon.png` | 180×180 | PNG | iOS Safari home screen |
| `icon-192.png` | 192×192 | PNG | Android PWA manifest |
| `icon-512.png` | 512×512 | PNG | Android PWA splash |

## HTML Integration

Add `<link>` tags to `apps/console/app/layout.tsx` `<head>`:

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/favicon-32.png" sizes="32x32" />
<link rel="icon" href="/favicon-16.png" sizes="16x16" />
<link rel="icon" href="/favicon.ico" sizes="48x48" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

## PWA Manifest

Create `apps/console/public/manifest.json`:

```json
{
  "name": "Intera",
  "short_name": "Intera",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "theme_color": "#8b6ff5",
  "background_color": "#f8f7f4",
  "display": "standalone"
}
```

Link manifest in `layout.tsx`:

```html
<link rel="manifest" href="/manifest.json" />
```

## Implementation Approach

1. Create `favicon.svg` as the source-of-truth vector
2. Use the SVG to rasterize all PNG sizes (via `sharp` CLI or manual export)
3. Combine 16/32/48 into `favicon.ico` (via `png2ico` or similar)
4. Add `<link>` tags to `layout.tsx`
5. Create `manifest.json` and link it

## Testing Checklist

- [ ] SVG renders correctly in Chrome, Firefox, Safari
- [ ] 16px and 32px PNGs are legible
- [ ] ICO shows correctly in legacy browsers / bookmarks
- [ ] Apple touch icon appears on iOS Safari "Add to Home Screen"
- [ ] Manifest icons work for PWA install prompt
- [ ] No console errors related to favicon/manifest loading
