// Pure DOM helpers for the Intera animated logo lockup.
// No React dependency — returns native DOM elements.

const COL = { lavender: '#8b6ff5', indigo: '#5b8af7' }

export function gradDefs(id: string): string {
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${COL.lavender}"/><stop offset="1" stop-color="${COL.indigo}"/></linearGradient></defs>`
}

/** Serif "I" strokes for the disc — 4 lines: top serif, stem, bottom serif, gradient base */
export function serifISvg(size: number, strokeColor: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 64 64')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.style.position = 'relative'
  svg.innerHTML = gradDefs('inkGrad') + `
    <line class="i-top" x1="24" y1="22" x2="40" y2="22" stroke="${strokeColor}" stroke-width="3" stroke-linecap="round"/>
    <line class="i-stem" x1="32" y1="22" x2="32" y2="44" stroke="${strokeColor}" stroke-width="5" stroke-linecap="round"/>
    <line class="i-bot" x1="24" y1="44" x2="40" y2="44" stroke="${strokeColor}" stroke-width="3" stroke-linecap="round"/>
    <line class="i-base" x1="16" y1="52" x2="48" y2="52" stroke="url(#inkGrad)" stroke-width="2.5" stroke-linecap="round" opacity="0.9"/>`
  return svg
}

/** Serif "A" strokes — 7 lines: left leg, left serif, right leg, right serif, crossbar, apex, base */
export function serifASvg(size: number, strokeColor: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 64 64')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.style.position = 'relative'
  svg.innerHTML = gradDefs('aGrad') + `
    <line class="a-l" x1="19" y1="46" x2="31" y2="18" stroke="${strokeColor}" stroke-width="4.5" stroke-linecap="round"/>
    <line class="a-l-serif" x1="11" y1="46" x2="26" y2="46" stroke="${strokeColor}" stroke-width="2.8" stroke-linecap="round"/>
    <line class="a-r" x1="45" y1="46" x2="33" y2="18" stroke="${strokeColor}" stroke-width="4.5" stroke-linecap="round"/>
    <line class="a-r-serif" x1="38" y1="46" x2="53" y2="46" stroke="${strokeColor}" stroke-width="2.8" stroke-linecap="round"/>
    <line class="a-bar" x1="22" y1="36" x2="42" y2="36" stroke="${strokeColor}" stroke-width="3.2" stroke-linecap="round"/>
    <line class="a-apex" x1="26" y1="18" x2="38" y2="18" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round"/>
    <line class="a-base" x1="8" y1="52" x2="56" y2="52" stroke="url(#aGrad)" stroke-width="2.5" stroke-linecap="round" opacity="0.85"/>`
  return svg
}

export function discBackground(theme: 'light' | 'dark'): string {
  if (theme === 'dark') {
    return 'linear-gradient(150deg, rgba(139,111,245,0.30), rgba(91,138,247,0.10))'
  }
  return 'linear-gradient(150deg, rgba(139,111,245,0.15), rgba(91,138,247,0.05))'
}

export function discBorder(theme: 'light' | 'dark'): string {
  return theme === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(139,111,245,0.2)'
}

export function discShadow(theme: 'light' | 'dark'): string {
  return theme === 'dark'
    ? 'inset 0 1px 0 rgba(255,255,255,0.12), 0 0 26px rgba(139,111,245,0.22)'
    : 'inset 0 1px 0 rgba(255,255,255,0.6), 0 2px 14px rgba(0,0,0,0.05)'
}

export interface DiscElements {
  disc: HTMLDivElement
  shimmer: HTMLDivElement
}

/** Creates a glass disc/capsule div with gradient bg, border, box-shadow, and shimmer child */
export function makeDisc(
  size: number,
  theme: 'light' | 'dark',
  borderRadius: string = '50%',
): DiscElements {
  const d = document.createElement('div')
  d.className = 'intera-disc'
  d.style.width = size + 'px'
  d.style.height = size + 'px'
  d.style.borderRadius = borderRadius
  d.style.background = discBackground(theme)
  d.style.border = `1px solid ${discBorder(theme)}`
  d.style.boxShadow = discShadow(theme)

  const sh = document.createElement('div')
  sh.className = 'intera-disc-shimmer'
  d.appendChild(sh)

  return { disc: d, shimmer: sh }
}
