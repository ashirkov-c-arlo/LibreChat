import { effortValues } from './models';
import type { EffortField, EffortValue, EffortSelectorConfig, TModelSpec } from './models';

export type ResolvedEffortConfig = {
  field: EffortField;
  options: EffortValue[];
  defaultValue: EffortValue;
  selectedValue: EffortValue;
};

/** The sibling param a spec of the opposite family writes to. Used only to
 *  carry a user's choice across a model switch; never written alongside. */
const siblingField: Record<EffortField, EffortField> = {
  effort: 'reasoning_effort',
  reasoning_effort: 'effort',
};

const effortValueSet = new Set<string>(effortValues);

export function isEffortValue(value: unknown): value is EffortValue {
  return typeof value === 'string' && effortValueSet.has(value);
}

/** Structural params so `TConversation`, `TPreset` and `TModelSpecPreset` all
 *  satisfy them without a cast at the call site. */
type EffortParams = {
  effort?: unknown;
  reasoning_effort?: unknown;
};

type EffortSpec = {
  effortSelector?: EffortSelectorConfig;
  preset?: EffortParams | null;
};

/**
 * Resolves the effort control state for the active modelSpec.
 *
 * `params` is the conversation (or preset) the value is read from. Precedence:
 *   1. the spec's own field, when its value is offered by this spec
 *   2. the sibling field, when its value is offered by this spec — this is what
 *      makes `Claude/high -> GPT/high` carry over while `Claude/max -> GPT`
 *      falls back, since `max` is not a GPT option
 *   3. `preset[field]`, the single source of the default
 *
 * Returns `null` when the spec opts out (no `effortSelector`), which is the
 * signal for the UI to render nothing and for callers to touch no effort field.
 */
export function resolveEffortConfig(
  modelSpec?: EffortSpec | null,
  params?: EffortParams | null,
): ResolvedEffortConfig | null {
  const selector = modelSpec?.effortSelector;
  if (!selector) {
    return null;
  }

  const { field, options } = selector;
  const presetDefault = modelSpec?.preset?.[field];
  /** Config validation guarantees this, but public config is not re-validated
   *  client-side; fall back to the first option rather than rendering empty. */
  const defaultValue: EffortValue = isEffortValue(presetDefault)
    ? presetDefault
    : (options[0] as EffortValue);

  const current = params?.[field];
  if (isEffortValue(current) && options.includes(current)) {
    return { field, options, defaultValue, selectedValue: current };
  }

  const carried = params?.[siblingField[field]];
  if (isEffortValue(carried) && options.includes(carried)) {
    return { field, options, defaultValue, selectedValue: carried };
  }

  return { field, options, defaultValue, selectedValue: defaultValue };
}

/**
 * Resolves the active spec by stable identity: the persisted spec name first,
 * then an exact endpoint + provider model match. Labels are never matched.
 */
export function findActiveModelSpec(
  specs?: TModelSpec[] | null,
  params?: { spec?: string | null; endpoint?: string | null; model?: string | null } | null,
): TModelSpec | undefined {
  if (!specs?.length || !params) {
    return undefined;
  }

  const specName = params.spec;
  if (specName != null && specName !== '') {
    const byName = specs.find((spec) => spec.name === specName);
    if (byName) {
      return byName;
    }
  }

  const { endpoint, model } = params;
  if (endpoint == null || endpoint === '' || model == null || model === '') {
    return undefined;
  }

  return specs.find(
    (spec) => spec.preset?.endpoint === endpoint && spec.preset?.model === model,
  );
}
