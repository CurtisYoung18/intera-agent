// SOP todo_write / todo_read interceptor — extracted from AgentLoop.
// Replaces mock tool results with real in-memory CaseMemory operations.

import { SOP_INTERNAL_TOOLS } from './tools'
import type { ToolExecutionResult } from './streaming-tool-executor'
import type { ChatMemoryManager } from './memory'

const sopToolNames = new Set(SOP_INTERNAL_TOOLS.map((s) => s.name))

export function processTodoTools(
  results: ToolExecutionResult[],
  chatMemory: ChatMemoryManager,
): ToolExecutionResult[] {
  return results.map((result) => {
    if (!sopToolNames.has(result.name)) return result

    if (result.name === 'todo_read') {
      return {
        ...result,
        output: {
          ok: true,
          todos: chatMemory.getTodos(),
          dashboardVersion: chatMemory.getDashboardVersion(),
        },
      }
    }

    if (result.name === 'todo_write') {
      const raw = result.toolUse?.input as Record<string, unknown> | undefined
      let input: { action?: string; id?: string; text?: string; notes?: string; status?: string } | undefined = raw as any

      if (!input) {
        const existingError = (result.output as Record<string, unknown> | null)?.error as string | undefined
        if (!result.toolUse && existingError) {
          return {
            ...result,
            output: {
              ok: false,
              error: `todo_write input invalid: ${existingError}`,
              todos: chatMemory.getTodos(),
              dashboardVersion: chatMemory.getDashboardVersion(),
            },
          }
        }
        return {
          ...result,
          output: {
            ok: false,
            error: 'todo_write requires action ("add"|"update"|"complete"|"cancel") and relevant fields. Current todos returned so you can proceed.',
            todos: chatMemory.getTodos(),
            dashboardVersion: chatMemory.getDashboardVersion(),
          },
        }
      }

      if (!input.action) {
        if (Array.isArray((raw as any)?.todos)) {
          const batchItems = (raw as any).todos as Array<{ text?: string; notes?: string }>
          let lastTodos = chatMemory.getTodos()
          for (const item of batchItems) {
            if (item?.text) {
              const out = chatMemory.applyTodoAction({ action: 'add', text: item.text, notes: item.notes })
              lastTodos = out.todos
            }
          }
          return { ...result, output: { ok: true, todos: lastTodos, dashboardVersion: chatMemory.getDashboardVersion() } }
        } else if (input.id) {
          input = { ...input, action: 'complete' }
        } else if (input.text) {
          input = { ...input, action: 'add' }
        } else {
          return {
            ...result,
            output: {
              ok: false,
              error: 'todo_write requires action ("add"|"update"|"complete"|"cancel"). Current todos returned so you can proceed.',
              todos: chatMemory.getTodos(),
              dashboardVersion: chatMemory.getDashboardVersion(),
            },
          }
        }
      }

      if (!input?.action) {
        return { ...result, output: { ok: false, error: 'Missing required field: action', todos: chatMemory.getTodos() } }
      }

      const outcome = chatMemory.applyTodoAction(input as any)
      return { ...result, output: { ok: true, todos: outcome.todos, dashboardVersion: chatMemory.getDashboardVersion() } }
    }

    return result
  })
}
