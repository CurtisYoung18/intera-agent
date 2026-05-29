import { z } from 'zod'
import type { Tool, ToolContext } from '@intera/shared/tools/tool'
import { registerBuiltin } from '@intera/shared/tools/tool'

const inputSchema = z.object({
  action: z.enum(['add', 'update', 'complete', 'cancel']).describe(
    '"add" creates a new todo; "complete"/"cancel"/"update" require id.'
  ),
  id: z.string().optional().describe('Todo ID — required for update / complete / cancel.'),
  text: z.string().optional().describe('Todo description (required for add; optional for update).'),
  notes: z.string().optional().describe('Findings or reason for this state change.'),
})

type Input = z.infer<typeof inputSchema>
type Output = { ok: boolean; todos: Array<{ id: string; text: string; status: string; notes?: string }> }

export const todoWriteTool: Tool<Input, Output> = {
  name: 'todo_write',
  source: 'builtin',
  inputSchema,
  guardPhase: 'post',
  displayVerb: { text: 'Updating investigation plan', icon: 'dots' },

  async prompt(_ctx: ToolContext) {
    return 'Create, update, complete, or cancel a todo item in the case investigation plan. ' +
      'Use "add" to create a new todo, "complete" to mark one done (with findings as notes), ' +
      '"cancel" to drop an item that is no longer relevant, and "update" to revise text or notes. ' +
      'Always complete or cancel items as you progress — do not leave stale pending todos.'
  },

  isEnabled() { return true },
  isConcurrencySafe(_input: Input) { return true },
  isReadOnly(_input: Input) { return false },

  async call(input: Input, ctx: ToolContext): Promise<Output> {
    if (!ctx.chatMemory) {
      return { ok: false, todos: [] }
    }

    const result = ((ctx.chatMemory as any).applyTodoAction?.({ action: input.action, id: input.id, text: input.text, notes: input.notes }) ?? { changed: false, todos: [] })

    return {
      ok: result?.changed ?? false,
      todos: (result?.todos ?? []).map((t: any) => ({
        id: t.id,
        text: t.text,
        status: t.status,
        notes: t.notes,
      })),
    }
  },
}

registerBuiltin(todoWriteTool)
