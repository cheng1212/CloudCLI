import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OpenCodeProviderModels,
  OPENCODE_PREDEFINED_MODELS,
} from '@/modules/providers/list/opencode/opencode-models.provider.js';

test('OpenCode exposes only the curated predefined catalog', async () => {
  const adapter = new OpenCodeProviderModels();

  assert.deepEqual(await adapter.getSupportedModels(), OPENCODE_PREDEFINED_MODELS);
  assert.equal(
    (await adapter.getCurrentActiveModel()).model,
    OPENCODE_PREDEFINED_MODELS.DEFAULT,
  );
  // OpenCode routes by `<providerID>/<modelID>`, so every option has to carry a
  // provider prefix that `opencode models --verbose` reports. The curated list
  // only keeps the models used through the OpenCode Go key.
  const providerIds = new Set(
    OPENCODE_PREDEFINED_MODELS.OPTIONS.map((option) => option.value.split('/')[0]),
  );
  assert.deepEqual([...providerIds].sort(), ['opencode-go'].sort());
  assert.equal(
    OPENCODE_PREDEFINED_MODELS.OPTIONS.every((option) => /^[a-z0-9-]+\/.+/.test(option.value)),
    true,
  );
  assert.equal(
    new Set(OPENCODE_PREDEFINED_MODELS.OPTIONS.map((option) => option.value)).size,
    OPENCODE_PREDEFINED_MODELS.OPTIONS.length,
  );
  assert.equal(OPENCODE_PREDEFINED_MODELS.DEFAULT, 'opencode-go/deepseek-v4-flash');
  assert.equal(OPENCODE_PREDEFINED_MODELS.OPTIONS.length, 5);
  for (const expected of [
    'opencode-go/deepseek-v4-flash',
    'opencode-go/deepseek-v4-pro',
    'opencode-go/deepseek-v4-flash-vision-exp',
    'opencode-go/qwen3.8-flash',
    'opencode-go/glm-5.3-flash',
  ]) {
    assert.ok(
      OPENCODE_PREDEFINED_MODELS.OPTIONS.some((option) => option.value === expected),
      `missing curated model ${expected}`,
    );
  }
  // Every curated option carries a level-1 vendor group for two-level pickers.
  assert.ok(
    OPENCODE_PREDEFINED_MODELS.OPTIONS.every((option) => typeof option.group === 'string' && option.group.length > 0),
  );
});
