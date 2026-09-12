import type { ProviderModelOption } from '../../../types/app';

export interface GroupedModelOptions {
  /** Level-1 source label (vendor/upstream). Empty string = ungrouped. */
  group: string;
  options: ProviderModelOption[];
}

const MODEL_SOURCE_LABEL_SEPARATOR = ' | ';

/**
 * Fallback for options the server did not tag with a group: honor the
 * "Source | Name" display convention, else leave ungrouped.
 */
function extractFallbackGroup(label: string): string {
  const separatorIndex = label.indexOf(MODEL_SOURCE_LABEL_SEPARATOR);
  return separatorIndex > 0
    ? label.slice(0, separatorIndex).trim()
    : '';
}

/**
 * Buckets a flat model catalog into level-1 source groups for two-level
 * model pickers. When no option carries a group the result is a single
 * ungrouped bucket, so callers can keep their flat rendering unchanged.
 */
export function groupModelOptions(options: ProviderModelOption[]): GroupedModelOptions[] {
  const buckets = new Map<string, ProviderModelOption[]>();

  for (const option of options) {
    const group = option.group?.trim() || extractFallbackGroup(option.label || '') || '';
    const bucket = buckets.get(group);
    if (bucket) {
      bucket.push(option);
    } else {
      buckets.set(group, [option]);
    }
  }

  // Preserve the catalog's original ordering; unknown sources sink to the end.
  return [...buckets.entries()]
    .sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : 0))
    .map(([group, groupedOptions]) => ({ group, options: groupedOptions }));
}

/** True when the catalog should render as a two-level grouped list. */
export function hasModelGroups(groups: GroupedModelOptions[]): boolean {
  return groups.length > 1 || (groups.length === 1 && groups[0].group !== '');
}
