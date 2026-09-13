import { Check, ChevronRight, Copy, Edit2, ListChecks, MessageSquare, Pin, PinOff, Trash2, X } from 'lucide-react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { TFunction } from 'i18next';

import { Button } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { ProjectSession, LLMProvider } from '../../../../types/app';
import type { RecentConversationListItem } from '../../types/types';
import { formatCompactAge } from '../../utils/utils';
import LLMProviderLogo from '../../../llm-provider-logo/LLMProviderLogo';

type DeleteConversationPayload = {
  sessionId: string;
  projectId: string | null;
  sessionTitle: string;
  provider: string;
};

type SidebarRecentConversationsProps = {
  conversations: RecentConversationListItem[];
  total: number;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasError: boolean;
  selectedSession: ProjectSession | null;
  currentTime: Date;
  onConversationSelect: (
    projectId: string | null,
    sessionId: string,
    provider: string,
  ) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onTogglePin: (sessionId: string, isPinned: boolean) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onDeleteConversation: (session: DeleteConversationPayload) => void;
  onForkConversation: (sessionId: string) => Promise<string | null>;
  editingSession: string | null;
  editingSessionName: string;
  onEditingSessionNameChange: (value: string) => void;
  onCancelEditingSession: () => void;
  // Bulk manage (multi-select delete) mode. Row clicks toggle selection while
  // the mode is active; the action bar lives at the bottom of the list.
  isBulkMode: boolean;
  bulkSelectedSessionIds: ReadonlySet<string>;
  isBulkDeleteRunning: boolean;
  onEnterBulkMode: () => void;
  onExitBulkMode: () => void;
  onToggleBulkSelected: (sessionId: string) => void;
  onBulkSetSelected: (sessionIds: string[], selected: boolean) => void;
  onRequestBulkDelete: () => void;
  t: TFunction;
};

function RecentConversationSkeleton() {
  return (
    <div className="space-y-1 px-1" aria-label="Loading recent conversations">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="flex items-center gap-2 rounded-lg px-2 py-2.5">
          <div className="h-7 w-7 animate-pulse rounded-md bg-muted" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3 animate-pulse rounded bg-muted" style={{ width: `${72 - index * 3}%` }} />
            <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SidebarRecentConversations({
  conversations,
  total,
  hasMore,
  isLoading,
  isLoadingMore,
  hasError,
  selectedSession,
  currentTime,
  onConversationSelect,
  onLoadMore,
  onRetry,
  onTogglePin,
  onStartEditingSession,
  onSaveEditingSession,
  onDeleteConversation,
  onForkConversation,
  editingSession,
  editingSessionName,
  onEditingSessionNameChange,
  onCancelEditingSession,
  isBulkMode,
  bulkSelectedSessionIds,
  isBulkDeleteRunning,
  onEnterBulkMode,
  onExitBulkMode,
  onToggleBulkSelected,
  onBulkSetSelected,
  onRequestBulkDelete,
  t,
}: SidebarRecentConversationsProps) {
  if (isLoading && conversations.length === 0) {
    return <RecentConversationSkeleton />;
  }

  if (hasError && conversations.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <MessageSquare className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          {t('recent.loadFailed', 'Could not load recent conversations')}
        </p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={onRetry}>
          {t('buttons.retry', { ns: 'common', defaultValue: 'Try again' })}
        </Button>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <MessageSquare className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          {t('recent.emptyTitle', 'No conversations yet')}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('recent.emptyDescription', 'Your most recently updated conversations will appear here.')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col px-1" data-testid="recent-conversations-list">
      <div className="flex items-center justify-between px-2 pb-1.5 pt-0.5">
        <span className="text-[11px] font-medium text-muted-foreground">
          {isBulkMode
            ? t('recent.bulkTitle', 'Select conversations')
            : t('recent.title', 'Recent conversations')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] tabular-nums text-muted-foreground/70">{total}</span>
          {conversations.length > 0 && (
            <Button
              variant={isBulkMode ? 'secondary' : 'ghost'}
              size="sm"
              className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground"
              onClick={() => (isBulkMode ? onExitBulkMode() : onEnterBulkMode())}
              data-testid="bulk-manage-toggle"
            >
              <ListChecks className="h-3 w-3" />
              {isBulkMode
                ? t('recent.bulkExit', 'Cancel')
                : t('recent.bulkEnter', 'Batch manage')}
            </Button>
          )}
        </span>
      </div>

      {isBulkMode && (
        <div className="mb-1 flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-2 py-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[10px] text-muted-foreground"
            onClick={() => {
              const everyVisibleSelected = conversations.every((conversation) =>
                bulkSelectedSessionIds.has(conversation.sessionId),
              );
              onBulkSetSelected(
                conversations.map((conversation) => conversation.sessionId),
                !everyVisibleSelected,
              );
            }}
          >
            {conversations.every((conversation) => bulkSelectedSessionIds.has(conversation.sessionId))
              ? t('recent.bulkDeselectAll', 'Deselect all')
              : t('recent.bulkSelectAll', 'Select all')}
          </Button>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {t('recent.bulkSelectedCount', '{{count}} selected', { count: bulkSelectedSessionIds.size })}
          </span>
        </div>
      )}

      <div className={cn('min-h-0 flex-1 space-y-0.5', isBulkMode && 'overflow-y-auto pb-1')}>
        {conversations.map((conversation) => {
          const isSelected = String(selectedSession?.id ?? '') === conversation.sessionId;
          const isBulkSelected = bulkSelectedSessionIds.has(conversation.sessionId);
          const age = formatCompactAge(conversation.lastActivity, currentTime);
          const isEditing = editingSession === conversation.sessionId;

          const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
              return;
            }
            event.preventDefault();
            if (isBulkMode) {
              onToggleBulkSelected(conversation.sessionId);
              return;
            }
            onConversationSelect(
              conversation.projectId,
              conversation.sessionId,
              conversation.provider,
            );
          };

          const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSaveEditingSession(
                conversation.projectDisplayName,
                conversation.sessionId,
                editingSessionName,
                conversation.provider as LLMProvider,
              );
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onCancelEditingSession();
            }
          };

          if (isEditing) {
            return (
              <div
                key={conversation.sessionId}
                className="flex min-w-0 items-center gap-2 rounded-lg bg-accent/40 px-2 py-1.5"
              >
                <input
                  autoFocus
                  value={editingSessionName}
                  onChange={(event) => onEditingSessionNameChange(event.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  data-testid="rename-conversation-input"
                  className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-[13px] text-foreground outline-none focus:ring-1 focus:ring-ring"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 flex-shrink-0"
                  onClick={() =>
                    onSaveEditingSession(
                      conversation.projectDisplayName,
                      conversation.sessionId,
                      editingSessionName,
                      conversation.provider as LLMProvider,
                    )
                  }
                  aria-label={t('recent.saveRename', 'Save')}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 flex-shrink-0"
                  onClick={onCancelEditingSession}
                  aria-label={t('recent.cancelRename', 'Cancel')}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          }

          return (
            <a
              key={conversation.sessionId}
              href={`/session/${conversation.sessionId}`}
              onClick={handleClick}
              data-testid="recent-conversation-row"
              className={cn(
                'group flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors',
                isBulkSelected
                  ? 'bg-primary/15 text-foreground ring-1 ring-primary/30'
                  : isSelected
                    ? 'bg-primary/10 text-foreground'
                    : 'text-foreground hover:bg-accent/60',
              )}
            >
              {isBulkMode ? (
                <span
                  className={cn(
                    'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border transition-colors',
                    isBulkSelected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background',
                  )}
                  aria-hidden="true"
                >
                  {isBulkSelected && <Check className="h-3 w-3" />}
                </span>
              ) : (
                <span className={cn(
                  'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md',
                  isSelected ? 'bg-primary/10' : 'bg-muted/60',
                )}>
                  <LLMProviderLogo provider={conversation.provider} className="h-3.5 w-3.5" />
                </span>
              )}

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-normal leading-4">
                  {conversation.sessionTitle}
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] leading-3 text-muted-foreground">
                  <span className="truncate">{conversation.projectDisplayName}</span>
                  {age && (
                    <>
                      <span className="flex-shrink-0 text-muted-foreground/40">·</span>
                      <time className="flex-shrink-0 tabular-nums" dateTime={conversation.lastActivity ?? undefined}>
                        {age}
                      </time>
                    </>
                  )}
                </span>
              </span>

              {!isBulkMode && (
                <span className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onTogglePin(conversation.sessionId, !conversation.isPinned);
                    }}
                    aria-label={
                      conversation.isPinned
                        ? t('recent.unpin', 'Unpin')
                        : t('recent.pin', 'Pin')
                    }
                  >
                    {conversation.isPinned ? (
                      <PinOff className="h-3.5 w-3.5" />
                    ) : (
                      <Pin className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onStartEditingSession(conversation.sessionId, conversation.sessionTitle);
                    }}
                    aria-label={t('recent.rename', 'Rename')}
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void onForkConversation(conversation.sessionId);
                    }}
                    aria-label={t('recent.fork', 'Fork')}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onDeleteConversation({
                        sessionId: conversation.sessionId,
                        projectId: conversation.projectId,
                        sessionTitle: conversation.sessionTitle,
                        provider: conversation.provider,
                      });
                    }}
                    aria-label={t('recent.delete', 'Delete')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </span>
              )}

              {!isBulkMode && (
                <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
              )}
            </a>
          );
        })}
      </div>

      {isBulkMode && (
        <div
          className="sticky bottom-0 mt-1 flex items-center gap-1.5 border-t border-border/60 bg-background/95 px-1 py-2 backdrop-blur-sm"
          data-testid="bulk-action-bar"
        >
          <Button
            variant="outline"
            size="sm"
            className="h-7 flex-1 text-xs"
            onClick={onExitBulkMode}
            disabled={isBulkDeleteRunning}
          >
            {t('recent.bulkCancel', 'Cancel')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="h-7 flex-1 gap-1 text-xs"
            disabled={bulkSelectedSessionIds.size === 0 || isBulkDeleteRunning}
            onClick={onRequestBulkDelete}
            data-testid="bulk-delete-button"
          >
            <Trash2 className="h-3 w-3" />
            {isBulkDeleteRunning
              ? t('recent.bulkDeleting', 'Deleting...')
              : t('recent.bulkDelete', 'Delete ({{count}})', { count: bulkSelectedSessionIds.size })}
          </Button>
        </div>
      )}

      {!isBulkMode && hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 h-8 w-full text-xs text-muted-foreground"
          onClick={onLoadMore}
          disabled={isLoadingMore}
        >
          {isLoadingMore
            ? t('recent.loadingMore', 'Loading more...')
            : t('recent.loadMore', 'Load older conversations')}
        </Button>
      )}
    </div>
  );
}
