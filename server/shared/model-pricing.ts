/**
 * Per-model USD pricing for session cost estimation.
 *
 * Rates are USD per 1M tokens. Routed model ids (claude-routes.json) rarely
 * match vendor names verbatim — ids like `deepseek-flash[1m]`, upstream
 * echoes like `deepseek-v4.1-flash`, or library aliases like `nv-gpt-oss-20b`
 — so resolution is normalized prefix/contains matching, not exact equality.
 * Unknown pricing returns null rather than guessing a rate.
 */

export type ModelPricing = {
  /** USD per 1M non-cached input tokens. */
  inputPerM: number;
  /** USD per 1M output tokens. */
  outputPerM: number;
  /** USD per 1M cache-read input tokens (defaults to inputPerM). */
  cacheReadPerM?: number;
  /** USD per 1M cache-creation input tokens (defaults to inputPerM). */
  cacheWritePerM?: number;
};

export type ResolvedModelPricing = {
  pricing: ModelPricing | null;
  /** Why pricing is null/zero, shown next to cost in the UI when present. */
  note?: string;
};

type PricingEntry = {
  /** Lowercase fragments matched against the normalized model id. */
  match: string[];
  pricing: ModelPricing | null;
  note?: string;
};

// Peak-rate table (DeepSeek bills 50% off-peak outside UTC Mon–Fri
// 01:00–04:00 + 06:00–10:00); peak is used as the conservative upper bound.
const DEEPSEEK_FLASH_PEAK: ModelPricing = {
  inputPerM: 0.3,
  outputPerM: 1.2,
  cacheReadPerM: 0.006,
  cacheWritePerM: 0.3,
};

const PRICING_TABLE: PricingEntry[] = [
  { match: ['deepseek-flash', 'deepseek-v4.1-flash'], pricing: DEEPSEEK_FLASH_PEAK, note: 'DeepSeek Flash 峰值价' },
  {
    match: ['deepseek-v4-pro'],
    pricing: { inputPerM: 1.32, outputPerM: 3.96, cacheReadPerM: 0.044, cacheWritePerM: 1.32 },
    note: 'DeepSeek V4 Pro 峰值价',
  },
  {
    match: ['claude-sonnet-4', 'claude-sonnet-5'],
    pricing: { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.3, cacheWritePerM: 3.75 },
  },
  {
    match: ['claude-opus'],
    pricing: { inputPerM: 15, outputPerM: 75, cacheReadPerM: 1.5, cacheWritePerM: 18.75 },
  },
  {
    match: ['claude-haiku'],
    pricing: { inputPerM: 1, outputPerM: 5, cacheReadPerM: 0.1, cacheWritePerM: 1.25 },
  },
  { match: ['nv-'], pricing: { inputPerM: 0, outputPerM: 0, cacheReadPerM: 0, cacheWritePerM: 0 }, note: 'NVIDIA NIM(免费额度)' },
  { match: ['go-'], pricing: { inputPerM: 0, outputPerM: 0, cacheReadPerM: 0, cacheWritePerM: 0 }, note: 'OpenCode Go 订阅(不按量计费)' },
];

export function resolveModelPricing(modelId: string | undefined | null): ResolvedModelPricing {
  const normalized = (modelId ?? '').trim().toLowerCase().replace(/\[1m\]$/, '');
  if (!normalized) {
    return { pricing: null };
  }

  for (const entry of PRICING_TABLE) {
    if (entry.match.some((fragment) => normalized.includes(fragment))) {
      return { pricing: entry.pricing, note: entry.note };
    }
  }

  return { pricing: null, note: '未知定价' };
}

export type CostUsageInput = {
  /** Non-cached input tokens actually billed at the input rate. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

/**
 * Computes USD cost from cumulative token counters and a pricing row.
 * Returns null when no pricing is known so the UI can show "—" instead of 0.
 */
export function computeCostUsd(usage: CostUsageInput, pricing: ModelPricing | null): number | null {
  if (!pricing) {
    return null;
  }

  const cacheReadPerM = pricing.cacheReadPerM ?? pricing.inputPerM;
  const cacheWritePerM = pricing.cacheWritePerM ?? pricing.inputPerM;
  return (
    (usage.inputTokens * pricing.inputPerM
      + usage.outputTokens * pricing.outputPerM
      + usage.cacheReadTokens * cacheReadPerM
      + usage.cacheCreationTokens * cacheWritePerM)
    / 1_000_000
  );
}
