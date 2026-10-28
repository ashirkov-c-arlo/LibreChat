import { z } from 'zod';
import type { EndpointTokenConfig, TokenConfig } from '~/types';

/**
 * `TokenConfig` values are numbers, so a model's reasoning efforts ride along as
 * flag keys (`'effort:high': 1`) and share every cache, scope and backfill path the
 * token config already has. Insertion order keeps the gateway's advertised order.
 */
const EFFORT_KEY_PREFIX = 'effort:';

const tokenCount = z.number().positive().nullish();
const costPerToken = z.number().nonnegative().nullish();

/** One entry of LiteLLM `GET /model_group/info`; fields we do not read are ignored. */
const modelGroupSchema = z.object({
  model_group: z.string().min(1),
  max_input_tokens: tokenCount,
  max_output_tokens: tokenCount,
  input_cost_per_token: costPerToken,
  output_cost_per_token: costPerToken,
  /** `null` means LiteLLM does not know the levels; never read as "none supported". */
  supported_reasoning_efforts: z.array(z.string()).nullish(),
});

/** LiteLLM serves `/model_group/info` at the proxy root, not under the OpenAI `/v1` prefix. */
export function getLiteLLMModelGroupInfoURL(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '').replace(/\/v1$/, '')}/model_group/info`;
}

/**
 * Maps LiteLLM model groups to an endpoint token config keyed by the public model name.
 * `context` is `max_input_tokens` and `output` is `max_output_tokens`, each only when
 * reported; malformed entries are skipped so one bad model cannot drop the rest.
 */
export function processLiteLLMModelGroups(input: unknown): EndpointTokenConfig {
  const data = (input as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    throw new Error('Invalid LiteLLM model_group/info response');
  }

  const tokenConfig: EndpointTokenConfig = {};
  for (const item of data) {
    const parsed = modelGroupSchema.safeParse(item);
    if (!parsed.success) {
      continue;
    }
    const group = parsed.data;
    const entry: Record<string, number> = {};
    if (group.max_input_tokens != null) {
      entry.context = group.max_input_tokens;
    }
    if (group.max_output_tokens != null) {
      entry.output = group.max_output_tokens;
    }
    if (group.input_cost_per_token != null) {
      entry.prompt = group.input_cost_per_token * 1_000_000;
    }
    if (group.output_cost_per_token != null) {
      entry.completion = group.output_cost_per_token * 1_000_000;
    }
    for (const effort of group.supported_reasoning_efforts ?? []) {
      entry[`${EFFORT_KEY_PREFIX}${effort}`] = 1;
    }
    tokenConfig[group.model_group] = entry as TokenConfig;
  }
  return tokenConfig;
}

/** Reasoning efforts stored by {@link processLiteLLMModelGroups}; undefined when none. */
export function getReasoningEfforts(config?: Partial<TokenConfig>): string[] | undefined {
  if (config == null) {
    return undefined;
  }
  const efforts = Object.keys(config)
    .filter((key) => key.startsWith(EFFORT_KEY_PREFIX))
    .map((key) => key.slice(EFFORT_KEY_PREFIX.length));
  return efforts.length > 0 ? efforts : undefined;
}
