import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Bot, Cpu, Folder, FolderPlus, Loader2, MessageSquarePlus, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import type { Project } from '../../../../types/app';
import { cn } from '../../../../lib/utils';
import { api } from '../../../../utils/api';

type NewConversationDialogProps = {
  projects: Project[];
  selectedProjectId?: string | null;
  onSelectProject: (project: Project, model: string | null, provider: string) => void;
  onClose: () => void;
  t: TFunction;
};

type ModelOption = {
  value: string;
  label?: string;
  description?: string;
};

/**
 * New-conversation chooser: pick the agent (Claude Code / Codex), a model, a
 * project (or create one), and jump straight into the new session.
 *
 * Projects follow the 5190 zcode convention — every conversation lives in a
 * project folder under one fixed root, and each project is a named subfolder
 * of that root. The chosen model is pinned to the session server-side via the
 * active-model endpoint before the chat view opens.
 */

// Fixed root folder: all projects are created as subfolders of this directory
// (same root the 5190 zcode app uses, so both UIs see the same projects).
const DEFAULT_PROJECT_ROOT = 'C:\\Users\\chengge\\zcode-projects';

const PROVIDERS: Array<{ id: 'claude' | 'codex'; label: string }> = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
];

function sanitizeProjectName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]/g, '-');
}

export default function NewConversationDialog({
  projects,
  selectedProjectId,
  onSelectProject,
  onClose,
  t,
}: NewConversationDialogProps) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [provider, setProvider] = useState<'claude' | 'codex'>('claude');
  const [newProjectName, setNewProjectName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>('');

  // Load the model catalog of the selected agent so the dialog can offer a
  // model choice; resets when the agent switches.
  useEffect(() => {
    let cancelled = false;
    const loadModels = async () => {
      setModelsLoading(true);
      setSelectedModel('');
      try {
        const response = await api.providerModels(provider);
        const payload = await response.json().catch(() => null);
        const options = Array.isArray(payload?.data?.OPTIONS) ? payload.data.OPTIONS : [];
        if (cancelled) return;
        setModelOptions(options);
        setSelectedModel(typeof payload?.data?.DEFAULT === 'string' ? payload.data.DEFAULT : (options[0]?.value ?? ''));
      } catch {
        if (!cancelled) setModelOptions([]);
      }
      if (!cancelled) setModelsLoading(false);
    };
    void loadModels();
    return () => {
      cancelled = true;
    };
  }, [provider]);

  // Starts the conversation in `project` with the chosen agent + model: the
  // session is allocated immediately, the custom title applied and the model
  // pinned server-side, so the first message already runs on what was picked.
  const startConversation = async (project: Project) => {
    setIsCreating(true);
    setCreateError(null);
    try {
      const projectPath = project.fullPath || project.path || '';
      const response = await api.createSession({ provider, projectPath, initialMessage: '' });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setCreateError(t('newConversation.createFailed', '会话创建失败'));
        return;
      }
      const sessionId = body?.data?.sessionId as string | undefined;
      if (!sessionId) {
        setCreateError(t('newConversation.createFailed', '会话创建失败'));
        return;
      }
      const trimmedTitle = title.trim();
      if (trimmedTitle) {
        try {
          await api.renameSession(sessionId, trimmedTitle);
        } catch {
          // Title is cosmetic; the session still opens.
        }
      }
      if (selectedModel) {
        try {
          await api.setSessionActiveModel(provider, sessionId, selectedModel);
        } catch {
          // Model pinning is best-effort; the session still opens.
        }
      }
      onSelectProject(project, selectedModel || null, provider);
      navigate(`/session/${sessionId}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCreating(false);
    }
  };

  // Creates a project from the typed NAME as a subfolder of the fixed root,
  // then starts the conversation in it.
  const handleCreateNewFolder = async () => {
    const name = sanitizeProjectName(newProjectName);
    if (!name || isCreating) {
      return;
    }

    setIsCreating(true);
    setCreateError(null);

    try {
      const fullPath = `${DEFAULT_PROJECT_ROOT}\\${name}`;
      const response = await api.createProject({ path: fullPath });
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

      await startConversation(project);
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
                {t('newConversation.dialogTitle', '新建会话')}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('newConversation.dialogDescription', '选智能体、模型和项目，开始新对话')}
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

        <div className="space-y-3 border-t border-border px-4 py-3">
          {/* 标题（可空） */}
          <div>
            <label htmlFor="new-conversation-title" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t('newConversation.titleLabel', '标题（可空）')}
            </label>
            <input
              id="new-conversation-title"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('newConversation.titlePlaceholder', '留空则自动命名')}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
              autoComplete="off"
            />
          </div>

          {/* 智能体（provider）选择 */}
          <div>
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Bot className="h-3.5 w-3.5" />
              {t('newConversation.agentLabel', '智能体')}
            </span>
            <div className="flex rounded-lg bg-muted/50 p-0.5">
              {PROVIDERS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setProvider(entry.id)}
                  aria-pressed={provider === entry.id}
                  className={cn(
                    'flex-1 rounded-md px-2 py-1.5 text-xs transition-all',
                    provider === entry.id
                      ? 'bg-background font-medium text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          {/* 模型选择（随智能体联动） */}
          <div>
            <label
              htmlFor="new-conversation-model"
              className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
            >
              <Cpu className="h-3.5 w-3.5" />
              {t('newConversation.modelLabel', '模型')}
            </label>
            {modelsLoading ? (
              <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('newConversation.modelsLoading', '模型加载中…')}
              </div>
            ) : (
              <select
                id="new-conversation-model"
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
              >
                {modelOptions.length === 0 && (
                  <option value="">{t('newConversation.modelsEmpty', '未加载到模型，将使用默认模型')}</option>
                )}
                {modelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label || option.value}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* 新建项目：固定根目录下的子文件夹 */}
        <div className="border-t border-border px-4 py-3">
          <p className="mb-1.5 flex items-start gap-1.5 text-[10px] leading-3 text-muted-foreground/80">
            <Folder className="mt-0.5 h-3 w-3 flex-shrink-0" />
            <span>{t('newConversation.rootHint', `总目录：${DEFAULT_PROJECT_ROOT}（在这里建子文件夹就是一个项目）`)}</span>
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateNewFolder();
            }}
          >
            <div className="flex gap-2">
              <input
                id="new-conversation-folder-path"
                type="text"
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                placeholder={t('newConversation.projectNamePlaceholder', '新建项目：输入项目名')}
                className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                autoComplete="off"
              />
              <button
                type="submit"
                disabled={isCreating || !newProjectName.trim()}
                className="flex h-9 flex-shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCreating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FolderPlus className="h-4 w-4" />
                )}
                {t('newConversation.createProject', '新建')}
              </button>
            </div>
            {createError && (
              <p className="mt-1.5 text-xs text-destructive">{createError}</p>
            )}
          </form>
        </div>

        {/* 已有项目列表 */}
        <div className="max-h-72 overflow-y-auto overscroll-contain border-t border-border px-2 py-2">
          {projects.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t('newConversation.noProjects', '还没有项目，在上方输入名字新建一个')}
            </p>
          ) : (
            <>
              <p className="px-3 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                {t('newConversation.existingProjects', '或选择已有项目')}
              </p>
              {projects.map((project) => {
                const isSelected = project.projectId === selectedProjectId;
                return (
                  <button
                    key={project.projectId}
                    onClick={() => void startConversation(project)}
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
              })}
            </>
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
