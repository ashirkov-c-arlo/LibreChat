import { memo, useEffect, useMemo } from 'react';
import * as Ariakit from '@ariakit/react';
import { Brain, Check, ChevronDown } from 'lucide-react';
import { TooltipAnchor, disabledInkClasses } from '@librechat/client';
import {
  isAgentsEndpoint,
  findActiveModelSpec,
  resolveEffortConfig,
  isAssistantsEndpoint,
  resolveModelCatalogKey,
  resolveMetadataEffortConfig,
} from 'librechat-data-provider';
import type { EffortValue } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import type { TranslationKeys } from '~/hooks';
import { useGetStartupConfig, useGetEndpointsQuery, useTokenConfigQuery } from '~/data-provider';
import { useSetIndexOptions, useLocalize } from '~/hooks';
import { useChatContext } from '~/Providers';
import { cn } from '~/utils';

/** Explicit map: dynamic key construction would defeat the typed key check. */
const effortLabelKeys: Record<EffortValue, TranslationKeys> = {
  none: 'com_ui_thinking_effort_none',
  minimal: 'com_ui_thinking_effort_minimal',
  low: 'com_ui_thinking_effort_low',
  medium: 'com_ui_thinking_effort_medium',
  high: 'com_ui_thinking_effort_high',
  max: 'com_ui_thinking_effort_max',
  xhigh: 'com_ui_thinking_effort_xhigh',
};

const MENU_ITEM_CLASS =
  'flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm text-text-primary data-[active-item]:bg-surface-tertiary';

/** `fallback` renders when no spec `effortSelector` or catalog effort applies (upstream's control). */
function ThinkingEffortSelector({ fallback = null }: { fallback?: ReactNode }) {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const { data: tokenConfig } = useTokenConfigQuery();
  /** Read the conversation from context, not from a prop: ChatForm passes a
   *  `stableConversation` memo whose dependency allowlist omits the effort
   *  params, so a prop would stay frozen on the value selected here. */
  const { conversation, isSubmitting } = useChatContext();
  const { setOption } = useSetIndexOptions();
  const menu = Ariakit.useMenuStore({ placement: 'top-start', focusLoop: true });

  const modelSpec = useMemo(
    () => findActiveModelSpec(startupConfig?.modelSpecs?.list, conversation),
    [startupConfig?.modelSpecs?.list, conversation],
  );
  /** A spec decides when active; otherwise the efforts the endpoint's metadata
   *  reports for this model (agents carry their own params, so they are skipped). */
  const resolved = useMemo(() => {
    if (modelSpec) {
      return resolveEffortConfig(modelSpec, conversation);
    }
    const endpoint = conversation?.endpoint;
    if (endpoint == null || isAgentsEndpoint(endpoint) || isAssistantsEndpoint(endpoint)) {
      return null;
    }
    const catalogKey = resolveModelCatalogKey(endpoint, tokenConfig);
    return resolveMetadataEffortConfig(
      tokenConfig?.[catalogKey]?.[conversation?.model ?? '']?.reasoningEfforts,
      endpointsConfig?.[endpoint]?.chatDefaults?.reasoningEffort,
      conversation,
    );
  }, [modelSpec, conversation, tokenConfig, endpointsConfig]);

  const field = resolved?.field;
  const selectedValue = resolved?.selectedValue;
  const storedValue = field == null ? undefined : conversation?.[field];

  /** Persist the resolved value whenever it diverges from what the conversation
   *  holds: seeds the preset default on a new chat, and repairs a value the
   *  newly-selected model does not offer (or carries a supported one across
   *  from the sibling field). Guarded by equality, so this settles in one pass. */
  useEffect(() => {
    if (field == null || selectedValue == null || storedValue === selectedValue) {
      return;
    }
    setOption(field)(selectedValue);
  }, [field, selectedValue, storedValue, setOption]);

  if (resolved == null || startupConfig?.interface?.parameters === false) {
    return <>{fallback}</>;
  }

  const label = localize(
    resolved.selectedValue == null
      ? 'com_ui_thinking_effort_default'
      : effortLabelKeys[resolved.selectedValue],
  );
  const controlLabel = localize('com_ui_thinking_effort');

  return (
    <>
      <TooltipAnchor
        description={`${controlLabel}: ${label}`}
        side="top"
        render={
          <Ariakit.MenuButton
            store={menu}
            render={<button type="button" />}
            data-testid="thinking-effort"
            aria-label={controlLabel}
            disabled={isSubmitting}
            className={cn(
              'h-theme-control rounded-theme-control-round text-text-secondary hover:bg-surface-hover hover:text-text-primary focus-visible:ring-text-primary flex shrink-0 items-center gap-1 px-2 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
              disabledInkClasses,
            )}
          >
            <Brain className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{label}</span>
            <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden="true" />
          </Ariakit.MenuButton>
        }
      />
      <Ariakit.Menu
        store={menu}
        portal
        gutter={6}
        aria-label={controlLabel}
        className="rounded-theme-menu-panel border-border-light bg-surface-secondary text-text-primary z-[200] min-w-[9rem] border p-1.5 shadow-lg outline-none"
      >
        {resolved.options.map((option) => (
          <Ariakit.MenuItem
            key={option}
            className={MENU_ITEM_CLASS}
            aria-checked={option === resolved.selectedValue}
            role="menuitemradio"
            onClick={() => {
              setOption(resolved.field)(option);
              menu.hide();
            }}
          >
            <span>{localize(effortLabelKeys[option])}</span>
            {option === resolved.selectedValue && (
              <Check className="size-4 shrink-0" aria-hidden="true" />
            )}
          </Ariakit.MenuItem>
        ))}
      </Ariakit.Menu>
    </>
  );
}

export default memo(ThinkingEffortSelector);
