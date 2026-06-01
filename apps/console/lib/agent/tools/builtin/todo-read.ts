import { z } from 'zod'
import type { Tool, ToolContext } from '@intera/shared/tools/tool'
import { registerBuiltin } from '@intera/shared/tools/tool'

const inputSchema = z.object({})

type Input = z.infer<typeof inputSchema>
type Output = { todos: Array<{ id: string; text: string; status: string; notes?: string }> }

export const todoReadTool: Tool<Input, Output> = {
  name: 'todo_read',
  source: 'builtin',
  inputSchema,
  guardPhase: 'post',
  displayVerb: { text: 'Reviewing investigation plan', icon: 'scan' },

  async prompt(_ctx: ToolContext) {
    return 'Read the current investigation todo list. Call this at the start of each turn to see pending, in-progress, and completed items before deciding what to do next.'
  },

  isEnabled() { return true },
  isConcurrencySafe(_input: Input) { return true },
  isReadOnly(_input: Input) { return true },

  async call(_input: Input, ctx: ToolContext): Promise<Output> {
    if (!ctx.chatMemory) {
      return { todos: [] }
    }

    const todos = (ctx.chatMemory as any).getTodos?.() ?? []

    return {
      todos: todos.map((t: any) => ({
        id: t.id,
        text: t.text,
        status: t.status,
        notes: t.notes,
      })),
    }
  },
}

registerBuiltin(todoReadTool)
