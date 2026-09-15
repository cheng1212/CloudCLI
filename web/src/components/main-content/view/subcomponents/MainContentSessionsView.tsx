import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Clock, MessageSquare, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api } from '../../../../utils/api';
import { Button } from '../../../../shared/view/ui';

import MobileMenuButton from './MobileMenuButton';

type SessionRow = {
  sessionId: string;
  provider: string;
  sessionTitle: string;
  lastActivity: string;
  projectDisplayName?: string;
};

const formatTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/**
 * Landing view shown when no project is selected: the recent conversations
 * list, so the app opens straight onto sessions instead of a project picker.
 */
export default function MainContentSessionsView({ isMobile, onMenuClick }: { isMobile: boolean; onMenuClick: () => void }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await api.recentConversations({ limit: 60 });
      const payload = await response.json();
      setRows(Array.isArray(payload?.data?.conversations) ? payload.data.conversations : []);
    } catch {
      setError(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full flex-col">
      {isMobile && (
        <div className="pwa-header-safe flex-shrink-0 border-b border-border/50 bg-background/80 p-2 backdrop-blur-sm sm:p-3">
          <MobileMenuButton onMenuClick={onMenuClick} compact />
        </div>
      )}

      <div className="flex flex-shrink-0 items-center justify-between border-b border-border/50 px-4 py-3">
        <h1 className="text-base font-semibold text-foreground">{t('mainContent.sessionsTitle', '会话')}</h1>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => void load()}
          aria-label={t('mainContent.refresh', '刷新')}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && rows.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            {t('mainContent.loadingSessions', '正在加载会话…')}
          </div>
        ) : error && rows.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            {t('mainContent.loadSessionsFailed', '会话加载失败')}
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {t('mainContent.retry', '重试')}
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-40 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {t('mainContent.noSessionsYet', '还没有会话，点左上角菜单新建一个吧')}
          </div>
        ) : (
          rows.map((row) => (
            <button
              key={row.sessionId}
              type="button"
              onClick={() => navigate(`/session/${row.sessionId}`)}
              className="flex w-full items-center gap-3 border-b border-border/40 px-4 py-3 text-left transition-colors hover:bg-muted/40"
            >
              <MessageSquare className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {row.sessionTitle || t('mainContent.untitledSession', '未命名会话')}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {row.projectDisplayName ?? row.provider} · {formatTime(row.lastActivity)}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
