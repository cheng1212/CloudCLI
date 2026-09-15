import assert from 'node:assert/strict';
import test from 'node:test';

import { computeCostUsd, resolveModelPricing } from '@/shared/model-pricing.js';

test('resolveModelPricing matches routed and upstream deepseek ids', () => {
  assert.equal(resolveModelPricing('deepseek-flash').pricing?.inputPerM, 0.3);
  assert.equal(resolveModelPricing('deepseek-flash[1m]').pricing?.outputPerM, 1.2);
  assert.equal(resolveModelPricing('deepseek-v4.1-flash').pricing?.inputPerM, 0.3);
  assert.equal(resolveModelPricing('deepseek-v4-pro').pricing?.outputPerM, 3.96);
});

test('resolveModelPricing marks zero-rate and unknown models', () => {
  const nv = resolveModelPricing('nv-nemotron-ultra');
  assert.equal(nv.pricing?.inputPerM, 0);
  assert.match(nv.note ?? '', /NVIDIA/);

  const go = resolveModelPricing('go-glm-5.3');
  assert.equal(go.pricing?.outputPerM, 0);

  assert.equal(resolveModelPricing('glm-4.5-air').pricing?.inputPerM, 0.111);
  assert.equal(resolveModelPricing('glm-5.2').pricing, null);
  assert.equal(resolveModelPricing('mystery-model').pricing, null);
  assert.equal(resolveModelPricing('').pricing, null);
  assert.equal(resolveModelPricing(undefined).pricing, null);
});

test('computeCostUsd bills cache counters at their own rates', () => {
  const deepseek = resolveModelPricing('deepseek-flash').pricing!;
  // 1M input miss + 1M cache read + 1M cache write + 1M output at flash peak:
  // 0.3 + 0.006 + 0.3 + 1.2 = 1.806 USD
  const cost = computeCostUsd(
    { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheCreationTokens: 1_000_000 },
    deepseek,
  );
  assert.ok(Math.abs((cost ?? 0) - 1.806) < 1e-9);
  assert.equal(computeCostUsd({ inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 }, null), null);
});
