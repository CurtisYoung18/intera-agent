/**
 * Seed script — creates invite-flow test fixtures against a LOCAL Postgres.
 *
 * Usage:
 *   DATABASE_URL=postgresql://intera:intera@localhost:5433/intera npx tsx scripts/seed-invite-fixtures.ts
 *
 * Idempotent: preserves existing tokens so invite URLs stay stable across re-runs.
 * NEVER run this against the production DATABASE_URL (in .env.local).
 */

import { randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const ORG_ID = 'org-acme'
const OWNER_EMAIL = 'owner@acme.local'
const INVITEE_EMAIL = 'invitee@example.com'

async function seed() {
  console.log('Seeding invite-flow fixtures (local DB only)…\n')

  // ── 1. Org: acme ──────────────────────────────────────────────────────
  const org = await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: { name: 'acme' },
    create: { id: ORG_ID, name: 'acme' },
  })
  console.log(`  ✓ Organization: ${org.name} (${org.id})`)

  // ── 2. Owner User + Membership ────────────────────────────────────────
  const owner = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: { name: 'Acme Owner' },
    create: { email: OWNER_EMAIL, name: 'Acme Owner' },
  })
  console.log(`  ✓ Owner user: ${owner.email} (${owner.id})`)

  const membership = await prisma.membership.upsert({
    where: { userId_orgId: { userId: owner.id, orgId: ORG_ID } },
    update: { role: 'owner' },
    create: { userId: owner.id, orgId: ORG_ID, role: 'owner' },
  })
  console.log(`  ✓ Owner membership: ${membership.role} on ${membership.orgId}`)

  // ── 3. Email-bound pending Invitation ──────────────────────────────────
  const existingByEmail = await prisma.invitation.findUnique({
    where: { email_orgId: { email: INVITEE_EMAIL, orgId: ORG_ID } },
  })
  const emailToken = existingByEmail?.token ?? randomBytes(32).toString('hex')
  const emailInvite = await prisma.invitation.upsert({
    where: { email_orgId: { email: INVITEE_EMAIL, orgId: ORG_ID } },
    update: {
      role: 'operator',
      state: 'pending',
      maxUses: null,
      useCount: 0,
      invitedBy: owner.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    create: {
      email: INVITEE_EMAIL,
      orgId: ORG_ID,
      invitedBy: owner.id,
      role: 'operator',
      token: emailToken,
      state: 'pending',
      maxUses: null,
      useCount: 0,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })
  console.log(`  ✓ Email-bound invitation: email=${emailInvite.email}, role=${emailInvite.role}, token=${emailToken.slice(0, 8)}…`)

  // ── 4. Share-link pending Invitation ───────────────────────────────────
  const existingShare = await prisma.invitation.findFirst({
    where: { orgId: ORG_ID, email: null, state: 'pending' },
  })
  const shareToken = existingShare?.token ?? randomBytes(32).toString('hex')
  let shareInvite
  if (existingShare) {
    shareInvite = await prisma.invitation.update({
      where: { id: existingShare.id },
      data: {
        role: 'viewer',
        state: 'pending',
        maxUses: 2,
        useCount: 0,
        invitedBy: owner.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })
  } else {
    shareInvite = await prisma.invitation.create({
      data: {
        email: null,
        orgId: ORG_ID,
        invitedBy: owner.id,
        role: 'viewer',
        token: shareToken,
        state: 'pending',
        maxUses: 2,
        useCount: 0,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })
  }
  console.log(`  ✓ Share-link invitation: role=${shareInvite.role}, maxUses=${shareInvite.maxUses}, token=${shareToken.slice(0, 8)}…`)

  // ── Print invite URLs ──────────────────────────────────────────────────
  console.log('\n── Invite URLs ──────────────────────────────────────────────')
  console.log(`  Email-bound:  /login?invite=${emailToken}`)
  console.log(`  Share-link:   /login?invite=${shareToken}`)
  console.log('──────────────────────────────────────────────────────────────\n')

  console.log('Seed complete.')
}

seed()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
