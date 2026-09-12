import { useState } from 'react';
import ReactDOM from 'react-dom';
import { Folder, FolderPlus, Loader2, MessageSquarePlus, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import type { Project } from '../../../../types/app';
import { cn } from '../../../../lib/utils';
import { api } from '../../../../utils/api';

type NewConversationDialogProps = {
  projects: Project[];
  selectedProjectId?: string | null;
  onSelectProject: (project: Project) => void;
  onClose: () => void;
  t: TFunction;
};

/**
 * Asks the user which project folder a new conversation should live in.
 *
 * Sessions are always bound to a project folder (`project_path`), so the header
 * button surfaces this chooser instead of silently picking the first project.
 * Besides selecting an existing project, the user can type a new folder path to
 * create the project on the fly.
 */

// Default folder for conversations created without an explicit path: a fresh
// subfolder under the user's D-drive workspace root. The dialog pre-fills it so
// the Create button works even when nothing is typed.
const DEFAULT_PROJECT_ROOT = 'D:\\项目开发';
const DEFAULT_PROJECT_BASE = '新对话';

// Picks the pre-filled path, appending a numeric suffix when the base folder is
// already a registered project so a blind Create never trips the 409 conflict.
function buildDefaultNewPath(projects: Project[]): string {
  const existing = new Set(
    projects.map((project) => (project.fullPath || project.path || '').trim().replace(/[\\/]+$/, '')),
  );
  const base = `${DEFAULT_PROJECT_ROOT}\\${DEFAULT_PROJECT_BASE}`;
  if (!existing.has(base)) {
    return base;
  }
  let index = 2;
  while (existing.has(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
}

export default function NewConversationDialog({
  projects,
  selectedProjectId,
  onSelectProject,
  onClose,
  t,
}: NewConversationDialogProps) {
  const [newPath, setNewPath] = useState(() => buildDefaultNewPath(projects));
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Creates a project from the typed folder path and, on success, starts the
  // conversation in it. Errors are shown inline so the user can correct the path.
  const handleCreateNewFolder = async () => {
    const trimmedPath = newPath.trim();
    if (!trimmedPath || isCreating) {
      return;
    }

    setIsCreating(true);
    setCreateError(null);

    try {
      const response = await api.createProject({ path: trimmedPath });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const details =
          data?.details || data?.error?.details || data?.error?.message || data?.message || 'Failed to create project';
        setCreateError(typeof details === 'string' ? details : 'Failed to create project');
        return;
      }

      const project = data?.project as Project | undefined;
      if (!project) {
        setCreateError(t('newConversation.createFailed', 'Project was created but returned no data'));
        return;
      }

      onSelectProject(project);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Failed to create project');
    } finally {
      setIsCreating(false);
    }
  };

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        // Clicking the backdrop (not the dialog) closes the chooser.
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('newConversation.dialogTitle')}
        className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 p-5 pb-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
              <MessageSquarePlus className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-foreground">
                {t('newConversation.dialogTitle', 'New conversation')}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('newConversation.dialogDescription', 'Pick a folder for this conversation')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t('newConversation.close', 'Close')}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-t border-border px-4 py-3">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateNewFolder();
            }}
          >
            <label
              htmlFor="new-conversation-folder-path"
              className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              {t('newConversation.enterPathLabel', 'Or enter a new folder path')}
            </label>
            <div className="flex gap-2">
              <input
                id="new-conversation-folder-path"
                type="text"
                value={newPath}
                onChange={(event) => setNewPath(event.target.value)}
                placeholder={t('newConversation.enterPathPlaceholder', 'e.g. D:\\my-new-project')}
                className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                autoComplete="off"
              />
              <button
                type="submit"
                disabled={isCreating || !newPath.trim()}
                className="flex h-9 flex-shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCreating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageSquarePlus className="h-4 w-4" />
                )}
                {t('newConversation.create', 'Create')}
              </button>
            </div>
            {createError && (
              <p className="mt-1.5 text-xs text-destructive">{createError}</p>
            )}
          </form>
        </div>

        <div className="max-h-72 overflow-y-auto overscroll-contain border-t border-border px-2 py-2">
          {projects.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t('newConversation.noProjects', 'No projects yet')}
            </p>
          ) : (
            projects.map((project) => {
              const isSelected = project.projectId === selectedProjectId;
              return (
                <button
                  key={project.projectId}
                  onClick={() => onSelectProject(project)}
                  className={cn(
                    'mb-0.5 flex w-full min-w-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors',
                    isSelected ? 'bg-primary/10' : 'hover:bg-accent/60',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md',
                      isSelected ? 'bg-primary/10' : 'bg-muted/60',
                    )}
                  >
                    <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-normal text-foreground">
                      {project.displayName}
                    </span>
                    <span className="block truncate text-[10px] leading-3 text-muted-foreground">
                      {project.fullPath || project.path}
                    </span>
                  </span>
                  {isSelected && (
                    <span className="flex-shrink-0 text-[10px] font-medium text-primary">
                      {t('newConversation.current', 'Current')}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border bg-muted/30 p-3">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {t('newConversation.cancel', 'Cancel')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}