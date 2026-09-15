import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api } from '../../../utils/api';
import { Button } from '../../../shared/view/ui';

type CronItem = {
  id: number;
  sessionId: string;
  name: string;
  prompt: string;
  schedule: string;
  active: boolean;
  runCount: number;
  lastRunAt: string | null;
  lastStatus: string | null;
  nextFireAt: string | null;
};

const fmtTime = (value: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/**
 * Management panel for the session cron scheduler: create, pause/resume,
 * run now, inspect fire history, delete.
 */
export default function CronPage({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [crons, setCrons] = useState<CronItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', schedule: '*/30 * * * *', prompt: '', sessionId: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.listCrons();
      const payload = await response.json();
      setCrons(Array.isArray(payload?.data) ? payload.data : []);
    } catch {
      setCrons([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(async () => {
    if (!form.sessionId.trim() || !form.prompt.trim() || !form.schedule.trim()) {
      setMessage(t('cronPage.formIncomplete', '请填全 会话ID / 周期 / 提示词'));
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const response = await api.createCron({
        sessionId: form.sessionId.trim(),
        schedule: form.schedule.trim(),
        prompt: form.prompt.trim(),
        name: form.name.trim(),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(payload?.error?.message || t('cronPage.createFailed', '创建失败'));
      } else {
        setShowForm(false);
        setForm({ name: '', schedule: '*/30 * * * *', prompt: '', sessionId: '' });
        await load();
      }
    } catch {
      setMessage(t('cronPage.createFailed', '创建失败'));
    }
    setBusy(false);
  }, [form, load, t]);

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } finally {
      setBusy(false);
    }
  }, [load]);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2">
          {!embedded && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)} aria-label="back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <h1 className="text-base font-semibold text-foreground">{t('cronPage.title', '定时任务')}</h1>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => void load()}
            aria-label={t('cronPage.refresh', '刷新')}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('cronPage.new', '新建')}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl space-y-4">
          {showForm && (
            <div className="space-y-2.5 rounded-xl border border-border/60 p-4">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <input
                  value={form.name}
                  onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
                  placeholder={t('cronPage.namePlaceholder', '名称(可选)')}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
                <input
                  value={form.schedule}
                  onChange={(event) => setForm((f) => ({ ...f, schedule: event.target.value }))}
                  placeholder="*/30 * * * *"
                  className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
                />
              </div>
              <input
                value={form.sessionId}
                onChange={(event) => setForm((f) => ({ ...f, sessionId: event.target.value }))}
                placeholder={t('cronPage.sessionPlaceholder', '会话 ID(在会话列表点开某个会话,地址栏 /session/ 后面那段)')}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs"
              />
              <textarea
                value={form.prompt}
                onChange={(event) => setForm((f) => ({ ...f, prompt: event.target.value }))}
                placeholder={t('cronPage.promptPlaceholder', '到点要执行的提示词')}
                rows={3}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              {message && <div className="text-xs text-destructive">{message}</div>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
                  {t('cronPage.cancel', '取消')}
                </Button>
                <Button size="sm" disabled={busy} onClick={() => void create()}>
                  {t('cronPage.create', '创建')}
                </Button>
              </div>
            </div>
          )}

          {crons.length === 0 && !loading && (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              {t('cronPage.empty', '还没有定时任务')}
            </div>
          )}

          {crons.map((cron) => (
            <div key={cron.id} className="rounded-xl border border-border/60 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{cron.name || t('cronPage.unnamed', '未命名')}</span>
                    <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-xs">{cron.schedule}</code>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${
                        cron.active ? 'bg-emerald-500/15 text-emerald-600' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {cron.active ? t('cronPage.active', '启用中') : t('cronPage.paused', '已暂停')}
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{cron.prompt}</div>
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    {t('cronPage.next', '下次')} {fmtTime(cron.nextFireAt)} · {t('cronPage.last', '上次')} {fmtTime(cron.lastRunAt)}
                    {cron.lastStatus ? ` (${cron.lastStatus})` : ''} · {t('cronPage.runCount', '已跑')} {cron.runCount}
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={busy}
                    onClick={() => void act(() => api.runCronNow(cron.id))}
                    aria-label={t('cronPage.runNow', '立即运行')}
                  >
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={busy}
                    onClick={() => void act(() => api.setCronActive(cron.id, !cron.active))}
                  >
                    {cron.active ? t('cronPage.pause', '暂停') : t('cronPage.resume', '启用')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    disabled={busy}
                    onClick={() => void act(() => api.deleteCron(cron.id))}
                    aria-label={t('cronPage.delete', '删除')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
