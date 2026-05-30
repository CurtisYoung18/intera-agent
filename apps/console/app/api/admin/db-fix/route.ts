import { NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export async function POST() {
  try {
    // Drop ALL unique and primary key constraints, then let prisma recreate them
    const tables = [
      'agent_configs', 'case_types', 'skills', 'policies', 'routings', 
      'knowledge_sources', 'livechat_configs', 'channel_health', 'channel_bindings',
      'cases', 'chat_memories', 'user_profiles', 'external_conversations',
      'human_tasks', 'webhook_events'
    ]
    const results: string[] = []
    for (const t of tables) {
      try {
        // Drop ALL constraints on this table (except FK which would cascade delete data)
        await prisma.$executeRawUnsafe(`DO $$ DECLARE r RECORD; BEGIN FOR r IN (SELECT conname FROM pg_constraint WHERE conrelid = '${t}'::regclass AND contype IN ('u','p')) LOOP EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I CASCADE', '${t}', r.conname); END LOOP; END $$;`)
        results.push(`${t}: OK`)
      } catch(e: any) { 
        results.push(`${t}: ${e.message?.slice(0,60)}`) 
      }
    }
    return NextResponse.json({ ok: true, results })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
