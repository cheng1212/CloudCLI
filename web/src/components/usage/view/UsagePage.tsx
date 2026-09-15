import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api } from '../../../utils/api';
import { Button } from '../../../shared/view/ui';

type UsageNumbers = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  turns: number;
  costUsd: number | null;
};

type UsageSummary = {
  range: string;
  totals: UsageNumbers & { sessions: number; cacheHitRate: number | null };
  byDay: Array<{
    date: string;
    sessions: number;
    totalTokens: number;
    costUsd: number | null;
    models: Array<{ model: string } & UsageNumbers & { costUsd: number | null }>;
  }>;
  byModel: Array<{ model: string; sessions: number } & UsageNumbers & { costUsd: number | null }>;
};

const fmtTokens = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};
const fmtCost = (usd: number | null) => (usd === null || usd === undefined ? '—' : `$${usd.toFixed(2)}`);
const modelColor = (model: string) => {
  let hash = 0;
  for (let i = 0; i < model.length; i += 1) hash = (hash * 31 + model.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360} 62% 52%)`;
};

const RANGES: Array<{ label: string; days: number }> = [
  { label: '7天', days: 7 },
  { label: '30天', days: 30 },
  { label: '全部', days: 0 },
];

export default function UsagePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async (rangeDays: number) => {
    setLoading(true);
    setError(false);
    try {
      const response = await api.usageSummary(rangeDays);
      const payload = await response.json();
      setSummary(payload?.data ?? null);
    } catch {
      setError(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const totals = summary?.totals;
  const maxDayTokens = Math.max(1, ...(summary?.byDay ?? []).map((d) => d.totalTokens));
  const recentDays = (summary?.byDay ?? []).slice(-60);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)} aria-label="back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-base font-semibold text-foreground">{t('usage.title', '用量统计')}</h1>
        </div>
        <div className="flex items-center gap-1">
          {RANGES.map((range) => (
            <button
              key={range.days}
              type="button"
              onClick={() => setDays(range.days)}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                days === range.days
                  ? 'bg-primary/15 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {range.label}
            </button>
          ))}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void load(days)} aria-label="refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading && !summary ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            {t('usage.loading', '正在统计…')}
          </div>
        ) : error && !summary ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            {t('usage.loadFailed', '用量加载失败')}
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-5">
            {/* 总览卡片 */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <div className="rounded-xl border border-border/60 p-3">
                <div className="text-xs text-muted-foreground">{t('usage.totalCost', '总费用(估)')}</div>
                <div className="mt-1 text-lg font-semibold text-foreground">{fmtCost(totals?.costUsd ?? null)}</div>
              </div>
              <div className="rounded-xl border border-border/60 p-3">
                <div className="text-xs text-muted-foreground">{t('usage.totalTokens', '总 Tokens')}</div>
                <div className="mt-1 text-lg font-semibold text-foreground">
                  {fmtTokens((totals?.inputTokens ?? 0) + (totals?.outputTokens ?? 0) + (totals?.cacheReadTokens ?? 0))}
                </div>
              </div>
              <div className="rounded-xl border border-border/60 p-3">
                <div className="text-xs text-muted-foreground">{t('usage.cacheHitRate', '缓存命中率')}</div>
                <div className="mt-1 text-lg font-semibold text-foreground">
                  {totals?.cacheHitRate != null ? `${(totals.cacheHitRate * 100).toFixed(1)}%` : '—'}
                </div>
              </div>
              <div className="rounded-xl border border-border/60 p-3">
                <div className="text-xs text-muted-foreground">{t('usage.sessionsTurns', '会话 / 回合')}</div>
                <div className="mt-1 text-lg font-semibold text-foreground">
                  {totals?.sessions ?? 0} / {totals?.turns ?? 0}
                </div>
              </div>
            </div>

            {/* 每日堆叠柱状图 */}
            <div className="rounded-xl border border-border/60 p-4">
              <div className="mb-3 text-sm font-medium text-foreground">{t('usage.dailyTitle', '每日用量(按模型堆叠)')}</div>
              {recentDays.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">{t('usage.noData', '所选范围暂无数据')}</div>
              ) : (
                <>
                  <div className="flex h-36 items-end gap-1">
                    {recentDays.map((day) => (
                      <div
                        key={day.date}
                        className="group relative flex h-full flex-1 flex-col justify-end"
                        title={`${day.date}\n${fmtTokens(day.totalTokens)} tokens · ${fmtCost(day.costUsd)} · ${day.sessions} 会话`}
                      >
                        <div
                          className="flex w-full flex-col-reverse overflow-hidden rounded-sm"
                          style={{ height: `${Math.max(2, (day.totalTokens / maxDayTokens) * 100)}%` }}
                        >
                          {day.models
                            .slice()
                            .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens))
                            .map((m) => {
                              const tokens = m.inputTokens + m.outputTokens + m.cacheReadTokens + m.cacheCreationTokens;
                              return (
                                <div
                                  key={m.model}
                                  style={{
                                    backgroundColor: modelColor(m.model),
                                    height: `${day.totalTokens > 0 ? (tokens / day.totalTokens) * 100 : 0}%`,
                                  }}
                                />
                              );
                            })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
                    <span>{recentDays[0]?.date}</span>
                    <span>{recentDays[recentDays.length - 1]?.date}</span>
                  </div>
                </>
              )}
            </div>

            {/* 模型明细 */}
            <div className="rounded-xl border border-border/60 p-4">
              <div className="mb-3 text-sm font-medium text-foreground">{t('usage.byModelTitle', '模型明细')}</div>
              <div className="space-y-2.5">
                {(summary?.byModel ?? []).map((m) => {
                  const total = m.inputTokens + m.outputTokens + m.cacheReadTokens + m.cacheCreationTokens;
                  const grand = summary?.totals.inputTokens ?? 1;
                  const share = Math.min(100, Math.round((total / Math.max(1, grand)) * 100));
                  return (
                    <div key={m.model}>
                      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ backgroundColor: modelColor(m.model) }} />
                          <span className="truncate font-medium text-foreground">{m.model}</span>
                        </span>
                        <span className="flex-shrink-0 text-muted-foreground">
                          {fmtTokens(total)} tokens · {fmtCost(m.costUsd)}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted/60">
                        <div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: modelColor(m.model) }} />
                      </div>
                    </div>
                  );
                })}
                {(summary?.byModel ?? []).length === 0 && (
                  <div className="py-6 text-center text-sm text-muted-foreground">{t('usage.noData', '所选范围暂无数据')}</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
