import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList, X } from 'lucide-react';

import type { SessionTodoState } from '../../hooks/useSessionTodos';
import type { TodoItem } from '../../tools/components/ContentRenderers/TodoList';

type SessionPlanButtonProps = {
  todos: SessionTodoState | null;
};

const PRIORITY_LABEL: Record<string, string> = {
  high: 'P0',
  medium: 'P1',
  low: 'P2',
};

function PlanRow({ todo }: { todo: TodoItem }) {
  const completed = todo.status === 'completed';
  const inProgress = todo.status === 'in_progress';
  const priorityLabel = todo.priority ? PRIORITY_LABEL[todo.priority] : undefined;

  return (
    <div
      className="flex items-start gap-2 py-1"
      data-status={todo.status}
    >
      <div className="mt-0.5 flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
        {completed && (
          <svg className="h-3.5 w-3.5 text-green-500 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
        {inProgress && (
          <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500 dark:bg-blue-400" />
        )}
        {!completed && !inProgress && (
          <svg className="h-3.5 w-3.5 text-muted-foreground/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" strokeWidth={2} />
          </svg>
        )}
      </div>

      {priorityLabel && (
        <span className="mt-0 flex-shrink-0 rounded border border-border/60 px-1 text-[10px] font-semibold leading-4 text-muted-foreground">
          {priorityLabel}
        </span>
      )}

      <div
        className={`min-w-0 flex-1 text-xs leading-5 ${
          completed
            ? 'text-muted-foreground line-through'
            : inProgress
              ? 'font-medium text-foreground'
              : 'text-foreground'
        }`}
      >
        {inProgress && <span className="mr-1 text-blue-500 dark:text-blue-400">▶</span>}
        {todo.content}
      </div>
    </div>
  );
}

/**
 * Floating plan-progress control. Renders nothing while the session has no
 * TodoWrite plan; once one exists, shows a compact "done/total" button that
 * opens the full checklist in a modal.
 */
export default function SessionPlanButton({ todos }: SessionPlanButtonProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);

  if (!todos || todos.totalCount === 0) {
    return null;
  }

  const progressLabel = `${todos.completedCount}/${todos.totalCount}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={t('plan.viewPlan')}
        title={t('plan.viewPlan')}
        className="flex h-8 items-center gap-1.5 rounded-lg border border-border/50 px-2 text-muted-foreground transition-all hover:bg-accent hover:text-foreground"
      >
        <ClipboardList className="h-4 w-4" />
        <span className="text-xs font-medium tabular-nums">{progressLabel}</span>
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="flex max-h-[70vh] w-full max-w-lg flex-col rounded-xl border border-border/50 bg-card shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">{t('plan.title')}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {t('plan.progress', { completed: todos.completedCount, total: todos.totalCount })}
                  {todos.currentTask && (
                    <span className="ml-1 text-blue-500 dark:text-blue-400">· {todos.currentTask}</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label={t('plan.close')}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {todos.todos.map((todo, index) => (
                <PlanRow key={todo.id ?? `${todo.content}-${index}`} todo={todo} />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
