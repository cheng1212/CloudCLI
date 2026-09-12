import { useMemo } from 'react';

import type { NormalizedMessage, SessionStore } from '../../../stores/useSessionStore';
import type { TodoItem } from '../tools/components/ContentRenderers/TodoList';

export interface SessionTodoState {
  todos: TodoItem[];
  completedCount: number;
  totalCount: number;
  /** Content of the first in-progress item, or null when nothing is active. */
  currentTask: string | null;
}

/**
 * Parse a TodoWrite tool input into a validated todo list. toolInput arrives
 * as an object over the store, but transcript history may carry it as a JSON
 * string, so both shapes are accepted.
 */
function parseTodoInput(toolInput: unknown): TodoItem[] | null {
  let input: unknown = toolInput;
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      return null;
    }
  }
  const todos = (input as { todos?: unknown } | null)?.todos;
  if (!Array.isArray(todos)) {
    return null;
  }
  const valid = todos.filter(
    (todo): todo is TodoItem =>
      Boolean(todo)
      && typeof todo === 'object'
      && typeof (todo as TodoItem).content === 'string'
      && typeof (todo as TodoItem).status === 'string',
  );
  return valid.length > 0 ? valid : null;
}

/**
 * Walk the merged transcript backwards and return the todos from the most
 * recent TodoWrite tool call. Top-level messages only — a subagent's own
 * TodoWrite lives inside a Task container and must not override the main plan.
 */
export function extractLatestTodos(messages: NormalizedMessage[]): TodoItem[] | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.kind !== 'tool_use' || message.toolName !== 'TodoWrite') {
      continue;
    }
    const todos = parseTodoInput(message.toolInput);
    if (todos) {
      return todos;
    }
  }
  return null;
}

function toSessionTodoState(todos: TodoItem[]): SessionTodoState {
  const completedCount = todos.filter((todo) => todo.status === 'completed').length;
  const current = todos.find((todo) => todo.status === 'in_progress') ?? null;
  return {
    todos,
    completedCount,
    totalCount: todos.length,
    currentTask: current ? (current.activeForm || current.content) : null,
  };
}

/**
 * Live plan progress for the active session, derived from the session store.
 * The store re-renders its consumer on every message change, so the merged
 * transcript reference in the memo dependency tracks realtime TodoWrite
 * updates as they stream in.
 */
export function useSessionTodos(
  sessionStore: SessionStore,
  activeSessionId: string | null,
): SessionTodoState | null {
  const messages = activeSessionId ? sessionStore.getMessages(activeSessionId) : [];

  return useMemo(() => {
    const todos = extractLatestTodos(messages);
    return todos ? toSessionTodoState(todos) : null;
     
  }, [messages]);
}
