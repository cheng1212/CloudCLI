import { useState, type ReactNode } from 'react';
import { Check, ChevronDown, Filter, MessageSquarePlus, Pencil, RefreshCw, Search, Trash2, X, PanelLeftClose } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button, Input } from '../../../../shared/view/ui';
import { CLOUDCLI_WORDMARK_FONT_FAMILY } from '../../../../shared/constants';
import { IS_PLATFORM } from '../../../../shared/utils';
import { cn } from '../../../../lib/utils';
import { api } from '../../../../utils/api';
import LLMProviderLogo from '../../../llm-provider-logo/LLMProviderLogo';
import { Bot } from 'lucide-react';
import type { Project, LLMProvider } from '../../../../types/app';
import type { RecentConversationListItem } from '../../types/types';
import type { SidebarSearchMode } from '../../types/types';

import GitHubStarBadge from './GitHubStarBadge';
import NewConversationDialog from './NewConversationDialog';

const MOD_KEY =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  opencode: 'OpenCode',
};

type SidebarHeaderProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  projectsCount: number;
  runningSessionsCount: number;
  archivedSessionsCount: number;
  isArchivedSessionsLoading: boolean;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  searchMode: SidebarSearchMode;
  onSearchModeChange: (mode: SidebarSearchMode) => void;
  recentConversations: RecentConversationListItem[];
  filterAgent: LLMProvider | null;
  onFilterAgentChange: (provider: LLMProvider | null) => void;
  conversationProjectFilter: string | null;
  onConversationProjectFilterChange: (projectId: string | null) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  projects: Project[];
  selectedProjectId?: string | null;
  onNewSession: (project: Project) => void;
  onCollapseSidebar: () => void;
  t: TFunction;
};

export default function SidebarHeader({
  isPWA,
  isMobile,
  isLoading,
  projectsCount,
  runningSessionsCount,
  archivedSessionsCount,
  isArchivedSessionsLoading,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  searchMode,
  onSearchModeChange,
  recentConversations,
  filterAgent,
  onFilterAgentChange,
  conversationProjectFilter,
  onConversationProjectFilterChange,
  onRefresh,
  isRefreshing,
  projects,
  selectedProjectId,
  onNewSession,
  onCollapseSidebar,
  t,
}: SidebarHeaderProps) {
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renamingProjectName, setRenamingProjectName] = useState('');

  const saveProjectRename = async (projectId: string) => {
    const nextName = renamingProjectName.trim();
    setRenamingProjectId(null);
    if (!nextName) return;
    try {
      const response = await api.renameProject(projectId, nextName);
      if (!response.ok) {
        console.error('[Sidebar] Project rename failed:', response.status);
      }
    } catch (error) {
      console.error('[Sidebar] Project rename error:', error);
    }
    onRefresh();
  };

  const removeProject = async (projectId: string, projectDisplayName: string) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(t('search.deleteProjectConfirm', `确定删除项目「${projectDisplayName}」吗？项目及其下所有会话都会被删除`))) {
      return;
    }
    try {
      await api.deleteProject(projectId, true);
    } catch (error) {
      console.error('[Sidebar] Project delete error:', error);
    }
    if (conversationProjectFilter === projectId) {
      onConversationProjectFilterChange(null);
    }
    onRefresh();
  };

  const openNewConversationDialog = () => {
    setNewConversationOpen(true);
  };

  // Per-agent project set: projects seen in that agent's conversations, plus
  // unclaimed projects (no conversations yet) which every agent can use.
  const providerProjectIds = new Map<string, Set<string>>();
  const claimedProjectIds = new Set<string>();
  for (const conversation of recentConversations) {
    if (!conversation.projectId) continue;
    claimedProjectIds.add(conversation.projectId);
    if (!providerProjectIds.has(conversation.provider)) {
      providerProjectIds.set(conversation.provider, new Set());
    }
    providerProjectIds.get(conversation.provider)!.add(conversation.projectId);
  }
  const visibleProjects = filterAgent
    ? projects.filter((project) => {
        const agentProjects = providerProjectIds.get(filterAgent);
        return !claimedProjectIds.has(project.projectId) || Boolean(agentProjects?.has(project.projectId));
      })
    : projects;

  const agentLabel = filterAgent
    ? (PROVIDER_LABELS[filterAgent] ?? filterAgent)
    : t('search.filterAllAgents', '全部智能体');
  const filterLabel = searchMode === 'running'
    ? t('search.runningOnly', '运行中')
    : searchMode === 'archived'
      ? t('search.archivedOnly', '归档')
      : conversationProjectFilter
        ? (projects.find((project) => project.projectId === conversationProjectFilter)?.displayName
          ?? t('search.filterAll', '全部会话'))
        : `${agentLabel} · ${t('search.filterAll', '全部会话')}`;

  const showSearchTools = (projectsCount > 0 || runningSessionsCount > 0 || archivedSessionsCount > 0 || isArchivedSessionsLoading) && !isLoading;
  const searchPlaceholder = searchMode === 'conversations'
    ? t('search.conversationsPlaceholder')
    : searchMode === 'archived'
      ? t('search.archivedPlaceholder', 'Search archived sessions...')
      : searchMode === 'running'
        ? t('search.runningPlaceholder', 'Search running sessions...')
        : t('projects.searchPlaceholder');
  const runningBadgeText = runningSessionsCount > 99 ? '99+' : String(runningSessionsCount);

  const LogoBlock = () => (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-primary/90 shadow-sm">
        <svg className="h-3.5 w-3.5 text-primary-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <h1
        className="truncate text-sm font-bold tracking-tight text-foreground"
        style={{ fontFamily: CLOUDCLI_WORDMARK_FONT_FAMILY }}
      >
        {t('app.title')}
      </h1>
    </div>
  );

  const filterDropdown = (
            <div className="relative">
              <button
                type="button"
                onClick={() => setFilterOpen((open) => !open)}
                className={cn(
                  'flex h-8 w-full items-center justify-between rounded-lg border border-border bg-muted/40 px-2.5 text-xs transition-colors hover:bg-muted/70',
                  filterOpen && 'border-primary/40',
                )}
                aria-expanded={filterOpen}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <Filter className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                  <span className="truncate font-normal text-foreground">
                    {filterLabel}
                  </span>
                </span>
                <ChevronDown className={cn('h-3 w-3 flex-shrink-0 text-muted-foreground transition-transform', filterOpen && 'rotate-180')} />
              </button>
              {filterOpen && (
                <>
                  {/* Invisible backdrop closes the menu on any outside click. */}
                  <div className="fixed inset-0 z-30" onClick={() => setFilterOpen(false)} />
                  <div className="absolute z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-lg">
                    <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                      {t('search.filterByAgent', '智能体')}
                    </div>
                    <FilterItem
                      label={t('search.filterAllAgents', '全部智能体')}
                      active={!filterAgent}
                      onClick={() => {
                        onFilterAgentChange(null);
                        setFilterOpen(false);
                      }}
                    />
                    {(Object.keys(PROVIDER_LABELS) as LLMProvider[]).map((providerId) => (
                      <FilterItem
                        key={providerId}
                        label={
                          <span className="flex items-center gap-1.5">
                            <LLMProviderLogo provider={providerId} className="h-3.5 w-3.5" />
                            {PROVIDER_LABELS[providerId]}
                          </span>
                        }
                        active={filterAgent === providerId}
                        onClick={() => {
                          onFilterAgentChange(providerId);
                          // 切智能体时,若当前项目不属于它则清掉项目筛选
                          if (conversationProjectFilter) {
                            const agentProjects = providerProjectIds.get(providerId);
                            if (claimedProjectIds.has(conversationProjectFilter)
                              && !agentProjects?.has(conversationProjectFilter)) {
                              onConversationProjectFilterChange(null);
                            }
                          }
                          onSearchModeChange('conversations');
                          setFilterOpen(false);
                        }}
                      />
                    ))}
                    <div className="my-1 border-t border-border/60" />
                    <FilterItem
                      label={t('search.filterAll', '全部会话')}
                      active={searchMode === 'conversations' && !conversationProjectFilter}
                      onClick={() => {
                        onConversationProjectFilterChange(null);
                        onSearchModeChange('conversations');
                        setFilterOpen(false);
                      }}
                    />
                    {visibleProjects.length > 0 && (
                      <>
                        <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                          {t('search.filterByProject', '该智能体的项目')}
                        </div>
                        {visibleProjects.map((project) => {
                          const isFiltering = searchMode === 'conversations' && conversationProjectFilter === project.projectId;
                          const isRenamingThis = renamingProjectId === project.projectId;
                          if (isRenamingThis) {
                            return (
                              <div key={project.projectId} className="flex items-center gap-1 px-2 py-1">
                                <input
                                  autoFocus
                                  value={renamingProjectName}
                                  onChange={(event) => setRenamingProjectName(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') void saveProjectRename(project.projectId);
                                    if (event.key === 'Escape') setRenamingProjectId(null);
                                  }}
                                  className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs focus:border-primary focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => void saveProjectRename(project.projectId)}
                                  className="flex h-7 w-7 items-center justify-center rounded-md text-primary hover:bg-primary/10"
                                  aria-label={t('search.renameSave', '保存')}
                                >
                                  <Check className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setRenamingProjectId(null)}
                                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
                                  aria-label={t('search.renameCancel', '取消')}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            );
                          }
                          return (
                            <div
                              key={project.projectId}
                              className={cn(
                                'group flex w-full items-center gap-1 rounded-md pr-1',
                                isFiltering ? 'bg-primary/10' : 'hover:bg-accent/60',
                              )}
                            >
                              <FilterItem
                                label={project.displayName}
                                active={isFiltering}
                                onClick={() => {
                                  onConversationProjectFilterChange(project.projectId);
                                  onSearchModeChange('conversations');
                                  setFilterOpen(false);
                                }}
                              />
                              <span className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRenamingProjectId(project.projectId);
                                    setRenamingProjectName(project.displayName);
                                  }}
                                  className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                                  aria-label={t('search.renameProject', '重命名')}
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void removeProject(project.projectId, project.displayName)}
                                  className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
                                  aria-label={t('search.deleteProject', '删除')}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </span>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
  );

  return (
    <div className="flex-shrink-0">
      {/* Desktop header */}
      <div
        className="hidden px-3 pb-2 pt-3 md:block"
        style={{}}
      >
        <div className="flex items-center justify-between gap-2">
          {IS_PLATFORM ? (
            <a
              href="https://cloudcli.ai/dashboard"
              className="flex min-w-0 items-center gap-2.5 transition-opacity hover:opacity-80"
              title={t('tooltips.viewEnvironments')}
            >
              <LogoBlock />
            </a>
          ) : (
            <LogoBlock />
          )}

          <div className="flex flex-shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
              onClick={onRefresh}
              disabled={isRefreshing}
              title={t('tooltips.refresh')}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${
                  isRefreshing ? 'animate-spin' : ''
                }`}
              />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
              onClick={openNewConversationDialog}
              title={t('tooltips.newConversation')}
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
              onClick={onCollapseSidebar}
              title={t('tooltips.hideSidebar')}
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <GitHubStarBadge />

        {/* Search bar */}
        {showSearchTools && (
          <div className="mt-2.5 space-y-2">
            {filterDropdown}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                type="text"
                placeholder={searchPlaceholder}
                value={searchFilter}
                onChange={(event) => onSearchFilterChange(event.target.value)}
                className="nav-search-input h-9 rounded-xl border-0 pl-9 pr-14 text-sm transition-all duration-200 placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              {searchFilter ? (
                <button
                  onClick={onClearSearchFilter}
                  aria-label={t('tooltips.clearSearch')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 hover:bg-accent"
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              ) : (
                <kbd
                  aria-hidden
                  title={t('tooltips.openCommandPalette')}
                  className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground md:inline-flex"
                >
                  {MOD_KEY}
                  <span>K</span>
                </kbd>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Desktop divider */}
      <div className="nav-divider hidden md:block" />

      {/* Mobile header */}
      <div
        className="p-3 pb-2 md:hidden"
        style={isPWA && isMobile ? { paddingTop: '16px' } : {}}
      >
        <div className="flex items-center justify-between">
          {IS_PLATFORM ? (
            <a
              href="https://cloudcli.ai/dashboard"
              className="flex min-w-0 items-center gap-2.5 transition-opacity active:opacity-70"
              title={t('tooltips.viewEnvironments')}
            >
              <LogoBlock />
            </a>
          ) : (
            <LogoBlock />
          )}

          <div className="flex flex-shrink-0 gap-1.5">
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 transition-all active:scale-95"
              onClick={onRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/90 text-primary-foreground transition-all active:scale-95"
              onClick={openNewConversationDialog}
              title={t('tooltips.newConversation')}
            >
              <MessageSquarePlus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Mobile search */}
        {showSearchTools && (
          <div className="mt-2.5 space-y-2">
            {filterDropdown}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                type="text"
                placeholder={searchPlaceholder}
                value={searchFilter}
                onChange={(event) => onSearchFilterChange(event.target.value)}
                className="nav-search-input h-10 rounded-xl border-0 pl-10 pr-9 text-sm transition-all duration-200 placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              {searchFilter && (
                <button
                  onClick={onClearSearchFilter}
                  aria-label={t('tooltips.clearSearch')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 hover:bg-accent"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Mobile divider */}
      <div className="nav-divider md:hidden" />

      {newConversationOpen && (
        <NewConversationDialog
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={(project, _model) => {
            setNewConversationOpen(false);
            onNewSession(project);
          }}
          onClose={() => setNewConversationOpen(false)}
          t={t}
        />
      )}
    </div>
  );
}

function FilterItem({
  label,
  active,
  onClick,
}: {
  label: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left text-xs transition-colors',
        active ? 'bg-primary/10 font-medium text-primary' : 'text-foreground hover:bg-accent/60',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">{label}</span>
      {active && <Check className="h-3 w-3 flex-shrink-0" />}
    </button>
  );
}
