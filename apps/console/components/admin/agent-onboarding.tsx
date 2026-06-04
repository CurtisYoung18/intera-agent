'use client'

import { useState } from 'react'
import { Bot, ArrowRight, Loader2, Sparkles, Brain, Puzzle, Shield, Layers, AlertTriangle, RefreshCw } from 'lucide-react'
import { useAgentContext } from '@/lib/agent/agent-context'

interface Props {
  children: React.ReactNode
}

export default function AgentOnboardingGate({ children }: Props) {
  const { agentConfigs, loading, loadError, retryLoad, refreshConfigs, selectAgent } = useAgentContext()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-indigo" size={24} />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-full px-4">
        <div style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: 'rgba(230,69,57,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px',
          }}>
            <AlertTriangle size={24} color="var(--vermillion)" />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--mist)', marginBottom: 8 }}>
            Failed to load agent configs
          </h2>
          <p style={{ fontSize: 13, color: 'var(--fog)', lineHeight: 1.5, marginBottom: 20 }}>
            {loadError}
          </p>
          <button
            type="button"
            onClick={retryLoad}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '10px 24px', borderRadius: 10,
              background: 'var(--indigo)', color: '#fff', fontSize: 13, fontWeight: 600,
              border: 'none', cursor: 'pointer',
            }}
          >
            <RefreshCw size={14} />
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (agentConfigs.length > 0) return <>{children}</>

  const handleCreate = async () => {
    setCreating(true)
    setError('')
    try {
      const r = await fetch('/api/admin/agent-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Default' }),
      })
      const d = await r.json()
      if (!r.ok) {
        const errMsg = typeof d.error === 'string' ? d.error : d.error?.message
        // If already exists, just refresh — agents were created elsewhere
        if (errMsg?.includes('already exists')) {
          await refreshConfigs()
          return
        }
        setError(errMsg || 'Failed to create agent')
        return
      }
      await refreshConfigs()
      const cfg = d.data?.config ?? d.config
      if (cfg?.id) selectAgent(cfg.id)
    } catch {
      setError('Network error — try again')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex items-center justify-center h-full px-4">
      <div style={{ maxWidth: 520, width: '100%', textAlign: 'center' }}>
        {/* Icon */}
        <div style={{
          width: 64, height: 64, borderRadius: 18,
          background: 'linear-gradient(135deg, rgba(91,138,247,0.15), rgba(139,111,245,0.10))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 24px',
        }}>
          <Bot size={28} color="var(--indigo)" />
        </div>

        <h1 style={{
          fontSize: 24, fontWeight: 700, color: 'var(--mist)',
          marginBottom: 8, letterSpacing: '-0.02em',
        }}>
          Create your first agent
        </h1>
        <p style={{
          fontSize: 14, color: 'var(--fog)', lineHeight: 1.6,
          marginBottom: 32, maxWidth: 380, margin: '0 auto 32px',
        }}>
          An agent is your AI support representative. Configure its brain,
          tools, guardrails, and memory — all from one place.
        </p>

        {/* Feature capsules */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
          marginBottom: 28, textAlign: 'left',
        }}>
          {[
            { icon: Brain, label: 'Model & Prompt', desc: 'Pick an LLM and write system instructions' },
            { icon: Puzzle, label: 'Tools & Skills', desc: 'Equip your agent with business capabilities' },
            { icon: Shield, label: 'Guardrails', desc: 'Set safety rules and escalation policies' },
            { icon: Layers, label: 'Case Types', desc: 'Define investigation workflows' },
          ].map((f) => (
            <div key={f.label} style={{
              padding: '10px 12px', borderRadius: 10,
              border: '1px solid var(--border-subtle)',
              background: 'rgba(255,255,255,0.5)',
            }}>
              <f.icon size={14} color="var(--fog)" style={{ opacity: 0.5, marginBottom: 4 }} />
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mist)', marginBottom: 2 }}>
                {f.label}
              </div>
              <div style={{ fontSize: 11, color: 'var(--fog)', opacity: 0.6, lineHeight: 1.4 }}>
                {f.desc}
              </div>
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div style={{
            marginBottom: 16, padding: '8px 12px', borderRadius: 8,
            background: 'rgba(230,69,57,0.06)', border: '1px solid rgba(230,69,57,0.14)',
            fontSize: 12, color: 'var(--vermillion)',
          }}>
            {error}
          </div>
        )}

        {/* CTA */}
        <button
          type="button"
          disabled={creating}
          onClick={handleCreate}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '12px 28px', borderRadius: 12,
            background: 'linear-gradient(135deg, var(--indigo), #7c3aed)',
            color: '#fff', fontSize: 14, fontWeight: 600,
            border: 'none', cursor: creating ? 'not-allowed' : 'pointer',
            opacity: creating ? 0.7 : 1,
            boxShadow: '0 4px 20px -4px rgba(99,102,241,0.35)',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            if (!creating) {
              e.currentTarget.style.transform = 'translateY(-1px)'
              e.currentTarget.style.boxShadow = '0 8px 28px -4px rgba(99,102,241,0.45)'
            }
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'none'
            e.currentTarget.style.boxShadow = '0 4px 20px -4px rgba(99,102,241,0.35)'
          }}
        >
          {creating ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              Creating…
            </>
          ) : (
            <>
              <Sparkles size={15} />
              Create Agent
              <ArrowRight size={15} />
            </>
          )}
        </button>
      </div>
    </div>
  )
}
