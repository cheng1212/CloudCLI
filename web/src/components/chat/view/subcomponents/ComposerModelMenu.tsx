import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

import type { ProviderModelOption } from '../../../../types/app';
import { DEFAULT_EFFORT_VALUE } from '../../constants/providerEffort';
import { useComposerMenuAnchor } from '../../hooks/useComposerMenuAnchor';
import { groupModelOptions, hasModelGroups } from '../../utils/modelGroups';

import {
  ComposerMenuHeading,
  ComposerMenuItem,
  ComposerMenuSeparator,
  ComposerMenuSurface,
} from './ComposerMenuPrimitives';

type EffortOption = NonNullable<ProviderModelOption['effort']>['values'][number];

interface ComposerModelMenuProps {
  effort: string;
  /** Effort values the active provider/model actually accepts; empty hides the section. */
  effortOptions: EffortOption[];
  onSelectEffort: (effort: string) => void;
  model: string;
  /** Model catalog for the active provider; empty hides the section. */
  modelOptions: ProviderModelOption[];
  onSelectModel: (model: string) => void;
  modelsLoading: boolean;
}

export default function ComposerModelMenu({
  effort,
  effortOptions,
  onSelectEffort,
  model,
  modelOptions,
  onSelectModel,
  modelsLoading,
}: ComposerModelMenuProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const [isModelSectionOpen, setIsModelSectionOpen] = useState(false);
  // Which level-1 source group is drilled into (index into modelGroups).
  const [openGroupIndex, setOpenGroupIndex] = useState<number | null>(null);
  const close = useCallback(() => setIsOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close);

  // The model list starts collapsed every time the menu opens, the way Codex
  // shows reasoning first and keeps the longer model list one click away.
  // Drilling back out of a source group follows the same lifecycle.
  useEffect(() => {
    if (!isOpen) {
      setIsModelSectionOpen(false);
      setOpenGroupIndex(null);
    }
  }, [isOpen]);

  const defaultEffortLabel = t('composer.effortDefault', { defaultValue: 'Default' });
  const resolvedEffortOptions = useMemo<EffortOption[]>(
    () => (effortOptions.length > 0 ? [{ value: DEFAULT_EFFORT_VALUE }, ...effortOptions] : []),
    [effortOptions],
  );
  const effortLabel = effort === DEFAULT_EFFORT_VALUE ? defaultEffortLabel : effort;

  const selectedModelOption = useMemo(
    () => modelOptions.find((option) => option.value === model) ?? null,
    [model, modelOptions],
  );
  const modelLabel = selectedModelOption?.label || model;

  // Level-1 source groups (vendor/upstream). A catalog without any group
  // renders as the original flat list.
  const modelGroups = useMemo(() => groupModelOptions(modelOptions), [modelOptions]);
  const isModelListGrouped = useMemo(() => hasModelGroups(modelGroups), [modelGroups]);

  const hasEffortSection = resolvedEffortOptions.length > 0;
  const hasModelSection = modelOptions.length > 0 || modelsLoading;
  if (!hasEffortSection && !hasModelSection) {
    return null;
  }

  const triggerLabel = hasModelSection ? modelLabel : effortLabel;
  const ariaLabel = t('composer.modelMenu', {
    defaultValue: 'Select model and reasoning effort',
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          updateAnchor();
          setIsOpen((current) => !current);
        }}
        className="flex h-8 max-w-20 shrink-0 items-center gap-1 rounded-lg border border-border/60 bg-muted/40 px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted sm:max-w-56"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <span className="truncate">{triggerLabel}</span>
        {hasModelSection && hasEffortSection && effort !== DEFAULT_EFFORT_VALUE && (
          <span className="hidden shrink-0 capitalize text-muted-foreground sm:inline">· {effortLabel}</span>
        )}
      </button>

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={ariaLabel}>
          {hasEffortSection && (
            <>
              <ComposerMenuHeading>
                {t('composer.reasoning', { defaultValue: 'Reasoning' })}
              </ComposerMenuHeading>
              {resolvedEffortOptions.map((option) => (
                <ComposerMenuItem
                  key={option.value}
                  label={option.value === DEFAULT_EFFORT_VALUE ? defaultEffortLabel : option.value}
                  description={option.description}
                  isSelected={option.value === effort}
                  onSelect={() => {
                    onSelectEffort(option.value);
                    setIsOpen(false);
                  }}
                  className="capitalize"
                />
              ))}
            </>
          )}

          {hasModelSection && (
            <>
              {hasEffortSection && <ComposerMenuSeparator />}
              <ComposerMenuItem
                role="menuitem"
                label={modelLabel}
                isSelected={false}
                onSelect={() => setIsModelSectionOpen((current) => !current)}
                trailing={
                  isModelSectionOpen
                    ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                }
                className="text-muted-foreground"
              />

              {isModelSectionOpen && (
                <>
                  <ComposerMenuHeading>
                    {t('composer.model', { defaultValue: 'Model' })}
                  </ComposerMenuHeading>
                  {modelOptions.length === 0 && modelsLoading && (
                    <p className="px-2.5 py-1.5 text-sm text-muted-foreground">
                      {t('composer.loadingModels', { defaultValue: 'Loading models…' })}
                    </p>
                  )}
                  {isModelListGrouped && openGroupIndex === null ? (
                    // Level 1: source rows. Tapping one drills into its models.
                    modelGroups.map((modelGroup, index) => (
                      <ComposerMenuItem
                        key={modelGroup.group || 'ungrouped'}
                        role="menuitem"
                        label={modelGroup.group || t('composer.otherModels', { defaultValue: 'Other models' })}
                        description={t('composer.modelCount', { count: modelGroup.options.length })}
                        isSelected={modelGroup.options.some((option) => option.value === model)}
                        onSelect={() => setOpenGroupIndex(index)}
                        trailing={<ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                      />
                    ))
                  ) : isModelListGrouped ? (
                    // Level 2: the drilled-in source's models, with a back row.
                    (() => {
                      const currentGroup = openGroupIndex !== null
                        ? modelGroups[openGroupIndex] ?? modelGroups[0]
                        : modelGroups[0];
                      return (
                        <>
                          <ComposerMenuItem
                            role="menuitem"
                            label={currentGroup.group || t('composer.otherModels', { defaultValue: 'Other models' })}
                            isSelected={false}
                            onSelect={() => setOpenGroupIndex(null)}
                            trailing={<ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />}
                            className="text-muted-foreground"
                          />
                          {currentGroup.options.map((option: ProviderModelOption) => (
                            <ComposerMenuItem
                              key={option.value}
                              label={option.label || option.value}
                              isSelected={option.value === model}
                              onSelect={() => {
                                onSelectModel(option.value);
                                setIsOpen(false);
                              }}
                            />
                          ))}
                        </>
                      );
                    })()
                  ) : (
                    modelOptions.map((option) => (
                      <ComposerMenuItem
                        key={option.value}
                        label={option.label || option.value}
                        isSelected={option.value === model}
                        onSelect={() => {
                          onSelectModel(option.value);
                          setIsOpen(false);
                        }}
                      />
                    ))
                  )}
                </>
              )}
            </>
          )}
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}
