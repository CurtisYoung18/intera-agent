'use client'

import { useEffect, useState, useRef } from 'react'

interface Edge {
  from: string
  to: string
}

interface FlowEdgesProps {
  edges: Edge[]
  activeNode: string | null
}

export default function FlowEdges({ edges, activeNode }: FlowEdgesProps) {
  const [paths, setPaths] = useState<string[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const compute = () => {
      if (!containerRef.current) return
      const containerRect = containerRef.current.getBoundingClientRect()
      const newPaths: string[] = []

      edges.forEach(({ from, to }) => {
        const fromEl = document.getElementById(`flow-node-${from}`)
        const toEl = document.getElementById(`flow-node-${to}`)
        if (!fromEl || !toEl) return

        const fromRect = fromEl.getBoundingClientRect()
        const toRect = toEl.getBoundingClientRect()

        const x1 = fromRect.left - containerRect.left + fromRect.width / 2
        const y1 = fromRect.top - containerRect.top + fromRect.height / 2
        const x2 = toRect.left - containerRect.left + toRect.width / 2
        const y2 = toRect.top - containerRect.top + toRect.height / 2

        const dx = Math.abs(x2 - x1) * 0.4
        const path = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
        newPaths.push(path)
      })

      setPaths(newPaths)
    }

    compute()
    const onResize = () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(compute)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [edges])

  // Recompute when active node changes (layout may shift)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (containerRef.current) {
        const event = new Event('resize')
        window.dispatchEvent(event)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [activeNode])

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none" style={{ zIndex: 1 }}>
      <svg className="absolute inset-0 w-full h-full" style={{ overflow: 'visible' }}>
        {paths.map((d, i) => {
          const edge = edges[i]
          const isActive = activeNode && (edge.from === activeNode || edge.to === activeNode)
          return (
            <g key={i}>
              {/* Glow underlay */}
              <path
                d={d}
                fill="none"
                stroke={isActive ? 'rgba(139, 111, 245, 0.15)' : 'rgba(139, 111, 245, 0.04)'}
                strokeWidth={isActive ? 3 : 1.5}
                strokeDasharray="8 6"
                strokeLinecap="round"
                style={{
                  transition: 'stroke 500ms ease, stroke-width 500ms ease',
                }}
              />
              {/* Animated dash */}
              <path
                d={d}
                fill="none"
                stroke={isActive ? 'rgba(139, 111, 245, 0.3)' : 'rgba(139, 111, 245, 0.08)'}
                strokeWidth={isActive ? 1.5 : 1}
                strokeDasharray="4 12"
                strokeLinecap="round"
                className={isActive ? 'animate-edge-flow-active' : 'animate-edge-flow'}
                style={{
                  transition: 'stroke 500ms ease, stroke-width 500ms ease',
                }}
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}
