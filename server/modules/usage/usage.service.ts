import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { computeCostUsd, resolveModelPricing } from '@/shared/model-pricing.js';
import type { AnyRecord } from '@/shared/types.js';

type ModelDayUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  turns: number;
};

type CacheEntry = { at: number; payload: unknown };
const summaryCache = new Map<number, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function emptyUsage(): ModelDayUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, turns: 0 };
}

function addUsage(target: ModelDayUsage, add: Omit<ModelDayUsage, 'turns'>): void {
  target.inputTokens += add.inputTokens;
  target.outputTokens += add.outputTokens;
  target.cacheReadTokens += add.cacheReadTokens;
  target.cacheCreationTokens += add.cacheCreationTokens;
  target.turns += 1;
}

async function walkJsonlFiles(dir: string, out: string[], depth = 0): Promise<void> {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && depth < 4) {
      await walkJsonlFiles(full, out, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      out.push(full);
    }
  }
}

function serializeUsage(usage: ModelDayUsage, model: string | null) {
  const pricing = model ? resolveModelPricing(model).pricing : null;
  return {
    ...usage,
    costUsd: computeCostUsd(
      {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
      },
      pricing,
    ),
  };
}

/**
 * Aggregates token usage across all local Claude transcripts under
 * ~/.claude/projects (recursive .jsonl files): per day, per model, with USD
 * cost estimated through shared/model-pricing rates. Cached for 5 minutes.
 */
export async function buildUsageSummary(days: number): Promise<unknown> {
  const cached = summaryCache.get(days);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.payload;
  }

  const since = days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) : null;
  const totals = { ...emptyUsage(), sessions: new Set<string>() };
  const byDay = new Map<string, { models: Map<string, ModelDayUsage>; sessions: Set<string> }>();
  const byModel = new Map<string, ModelDayUsage & { sessions: Set<string> }>();

  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  const files: string[] = [];
  await walkJsonlFiles(projectsDir, files);

  for (const filePath of files) {
    let content: string;
    try {
      content = await fsp.readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    const providerSessionId = path.basename(filePath, '.jsonl');

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry: AnyRecord;
      try {
        entry = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (entry.type !== 'assistant') continue;
      const message = entry.message as AnyRecord | undefined;
      const usage = message?.usage as AnyRecord | undefined;
      if (!usage) continue;

      const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : null;
      const date = timestamp ? timestamp.slice(0, 10) : 'unknown';
      if (since && date !== 'unknown' && date < since) continue;
      const model = typeof message?.model === 'string' && message.model.trim()
        ? message.model.trim()
        : 'unknown';

      const add = {
        inputTokens: Number(usage.input_tokens) || 0,
        outputTokens: Number(usage.output_tokens) || 0,
        cacheReadTokens: Number(usage.cache_read_input_tokens) || 0,
        cacheCreationTokens: Number(usage.cache_creation_input_tokens) || 0,
      };

      if (!byDay.has(date)) byDay.set(date, { models: new Map(), sessions: new Set<string>() });
      const day = byDay.get(date)!;
      if (!day.models.has(model)) day.models.set(model, emptyUsage());
      addUsage(day.models.get(model)!, add);
      day.sessions.add(providerSessionId);

      if (!byModel.has(model)) byModel.set(model, { ...emptyUsage(), sessions: new Set<string>() });
      addUsage(byModel.get(model)!, add);
      byModel.get(model)!.sessions.add(providerSessionId);

      addUsage(totals, add);
      totals.sessions.add(providerSessionId);
    }
  }

  const byDayOut = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, day]) => {
      const models = [...day.models.entries()].map(([model, usage]) => ({
        model,
        ...serializeUsage(usage, model),
      }));
      const dayTokens = models.reduce(
        (sum, m) => sum + m.inputTokens + m.outputTokens + m.cacheReadTokens + m.cacheCreationTokens,
        0,
      );
      const dayCost = models.reduce((sum, m) => sum + (m.costUsd ?? 0), 0);
      return { date, sessions: day.sessions.size, totalTokens: dayTokens, costUsd: dayCost || null, models };
    });

  const byModelOut = [...byModel.entries()]
    .map(([model, usage]) => ({
      model,
      sessions: usage.sessions.size,
      ...serializeUsage(usage, model),
    }))
    .sort((a, b) => {
      const total = (u: typeof a) => u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheCreationTokens;
      return total(b) - total(a);
    });

  // Total cost is the sum of per-model estimates; null only when every model
  // in range has unknown pricing.
  const totalsCost = byModelOut.reduce((sum, m) => sum + (m.costUsd ?? 0), 0);

  const payload = {
    range: days > 0 ? `${days}d` : 'all',
    totals: {
      ...serializeUsage(totals, null),
      costUsd: byModelOut.some((m) => m.costUsd != null) ? totalsCost : null,
      sessions: totals.sessions.size,
      cacheHitRate: totals.cacheReadTokens + totals.inputTokens > 0
        ? totals.cacheReadTokens / (totals.cacheReadTokens + totals.inputTokens)
        : null,
    },
    byDay: byDayOut,
    byModel: byModelOut,
  };

  summaryCache.set(days, { at: Date.now(), payload });
  return payload;
}
