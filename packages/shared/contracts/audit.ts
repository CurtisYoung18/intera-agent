// Audit event contract — shared between defineRoute's audit() hook and
// Lane D's AuditLog writer. Every config mutation writes one row.

export interface AuditEvent {
  actorUserId: string
  orgId: string
  action: string // e.g. 'skill.create', 'skill.update', 'agent_config.activate'
  target: string // e.g. 'skill:my-skill-name', 'agent_config:abc123'
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

/** Callback signature exposed by defineRoute to route handlers. */
export type AuditWriter = (event: Omit<AuditEvent, 'actorUserId' | 'orgId'>) => Promise<void>
