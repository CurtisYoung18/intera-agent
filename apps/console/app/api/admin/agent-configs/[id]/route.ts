// PUT /api/admin/agent-configs/[id] — Rename a config; rename propagates to all versions of the same (orgId, name).
// DELETE /api/admin/agent-configs/[id] — Delete a version; block if it has children, auto-promote a sibling if deleting the active one.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { getActiveOrgId, getActiveVendor } from '@/lib/auth'
import { clearConfigCache } from '@/lib/agent/config-cache'

// Reserved names that would collide with the "default" auto-create path
const RESERVED_NAMES = new Set<string>(['default'])

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const orgId = await getActiveOrgId()
  const vendor = await getActiveVendor()
  if (!vendor?.isAuthed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const config = await prisma.agentConfig.findUnique({ where: { id } })
  if (!config || config.orgId !== orgId) {
    return NextResponse.json({ error: 'Config not found' }, { status: 404 })
  }
  const body = await request.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }
  if (RESERVED_NAMES.has(name.toLowerCase())) {
    return NextResponse.json({ error: `"${name}" is a reserved name` }, { status: 400 })
  }
  if (name === config.name) {
    // No-op rename
    return NextResponse.json({ config: { id: config.id, name: config.name, version: config.version, isActive: config.isActive, model: config.model, createdAt: config.createdAt, updatedAt: config.updatedAt } })
  }
  // Enforce no other name collision in this org (any (orgId, *, *) row that isn't this name group)
  const clash = await prisma.agentConfig.findFirst({
    where: { orgId, name, NOT: { name: config.name } },
    select: { id: true },
  })
  if (clash) {
    return NextResponse.json({ error: `An agent named "${name}" already exists` }, { status: 409 })
  }

  // Propagate rename to all versions of this (orgId, name) atomically
  await prisma.agentConfig.updateMany({
    where: { orgId, name: config.name },
    data: { name },
  })

  const updated = await prisma.agentConfig.findUnique({
    where: { id },
    select: { id: true, name: true, version: true, isActive: true, model: true, createdAt: true, updatedAt: true },
  })
  // Invalidate cache for every id in the renamed group
  const allInGroup = await prisma.agentConfig.findMany({
    where: { orgId, name },
    select: { id: true },
  })
  for (const row of allInGroup) clearConfigCache(orgId, row.id)
  clearConfigCache(orgId)

  return NextResponse.json({ config: updated })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const orgId = await getActiveOrgId()
  const vendor = await getActiveVendor()
  if (!vendor?.isAuthed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const config = await prisma.agentConfig.findUnique({ where: { id } })
  if (!config || config.orgId !== orgId) {
    return NextResponse.json({ error: 'Config not found' }, { status: 404 })
  }

  // Block delete when this version has children (forks of this fork)
  const childCount = await prisma.agentConfig.count({ where: { parentId: id } })
  if (childCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete — this version has ${childCount} child version${childCount !== 1 ? 's' : ''}. Delete or reassign them first.` },
      { status: 400 },
    )
  }

  // Must leave at least one version per (orgId, name)
  const siblingCount = await prisma.agentConfig.count({
    where: { orgId, name: config.name },
  })
  if (siblingCount <= 1) {
    return NextResponse.json(
      { error: 'Cannot delete the only version of this agent' },
      { status: 400 },
    )
  }

  // If deleting the active one, pick the highest-version sibling to promote
  if (config.isActive) {
    const successor = await prisma.agentConfig.findFirst({
      where: { orgId, name: config.name, NOT: { id }, isActive: false },
      orderBy: { version: 'desc' },
      select: { id: true },
    })
    if (!successor) {
      return NextResponse.json(
        { error: 'No other version available to promote — at least one sibling must exist' },
        { status: 400 },
      )
    }
    await prisma.$transaction([
      prisma.agentConfig.update({ where: { id: successor.id }, data: { isActive: true } }),
      prisma.agentConfig.delete({ where: { id } }),
    ])
    clearConfigCache(orgId, successor.id)
  } else {
    await prisma.agentConfig.delete({ where: { id } })
  }

  clearConfigCache(orgId, id)
  clearConfigCache(orgId)
  return NextResponse.json({ ok: true })
}
