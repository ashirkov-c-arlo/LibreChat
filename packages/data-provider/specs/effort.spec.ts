import {
  findActiveModelSpec,
  resolveEffortConfig,
  resolveMetadataEffortConfig,
} from '../src/effort';
import { specsConfigSchema } from '../src/models';
import { endpointSchema } from '../src/config';
import type { EffortField, EffortValue, TModelSpec } from '../src/models';

const CLAUDE_OPTIONS: EffortValue[] = ['low', 'medium', 'high', 'max'];
const GPT_OPTIONS: EffortValue[] = ['low', 'medium', 'high', 'xhigh'];
const OSS_OPTIONS: EffortValue[] = ['low', 'medium', 'high'];

const spec = (
  name: string,
  field: EffortField,
  options: EffortValue[],
  model: string,
  endpoint = 'bedrock',
): TModelSpec =>
  ({
    name,
    label: name,
    effortSelector: { field, options },
    preset: { endpoint, model, [field]: 'medium' },
  }) as unknown as TModelSpec;

const bare = (name: string, model: string): TModelSpec =>
  ({ name, label: name, preset: { endpoint: 'bedrock', model } }) as unknown as TModelSpec;

const specs: TModelSpec[] = [
  spec('opus-5', 'effort', CLAUDE_OPTIONS, 'us.anthropic.claude-opus-5'),
  spec('sonnet-5', 'effort', CLAUDE_OPTIONS, 'us.anthropic.claude-sonnet-5'),
  spec('opus-4-6', 'effort', CLAUDE_OPTIONS, 'us.anthropic.claude-opus-4-6-v1'),
  spec('gpt-5.6-sol', 'reasoning_effort', GPT_OPTIONS, 'openai.gpt-5.6-sol', 'Bedrock-OpenAI'),
  spec('gpt-5.6-luna', 'reasoning_effort', GPT_OPTIONS, 'openai.gpt-5.6-luna', 'Bedrock-OpenAI'),
  spec('glm-5', 'reasoning_effort', OSS_OPTIONS, 'zai.glm-5'),
  spec('kimi-k2-5', 'reasoning_effort', OSS_OPTIONS, 'moonshotai.kimi-k2.5'),
  bare('qwen3-235b', 'qwen.qwen3-235b-a22b-2507-v1:0'),
  bare('qwen3-vl', 'qwen.qwen3-vl-235b-a22b'),
];

const byName = (name: string) => specs.find((s) => s.name === name);

describe('resolveEffortConfig', () => {
  it.each([
    ['opus-5', 'effort', CLAUDE_OPTIONS],
    ['sonnet-5', 'effort', CLAUDE_OPTIONS],
    ['opus-4-6', 'effort', CLAUDE_OPTIONS],
    ['gpt-5.6-sol', 'reasoning_effort', GPT_OPTIONS],
    ['gpt-5.6-luna', 'reasoning_effort', GPT_OPTIONS],
    ['glm-5', 'reasoning_effort', OSS_OPTIONS],
    ['kimi-k2-5', 'reasoning_effort', OSS_OPTIONS],
  ] as [string, EffortField, EffortValue[]][])(
    '%s defaults to medium on a new conversation',
    (name, field, options) => {
      expect(resolveEffortConfig(byName(name), {})).toEqual({
        field,
        options,
        defaultValue: 'medium',
        selectedValue: 'medium',
      });
    },
  );

  it.each(['qwen3-235b', 'qwen3-vl'])('returns null for %s (no effortSelector)', (name) => {
    expect(resolveEffortConfig(byName(name), {})).toBeNull();
  });

  it('returns null for a missing spec', () => {
    expect(resolveEffortConfig(undefined, { effort: 'high' })).toBeNull();
  });

  it('keeps a stored value that the spec offers', () => {
    expect(resolveEffortConfig(byName('sonnet-5'), { effort: 'high' })?.selectedValue).toBe('high');
  });

  it('falls back to the preset default when the stored value is not offered', () => {
    expect(resolveEffortConfig(byName('glm-5'), { reasoning_effort: 'xhigh' })?.selectedValue).toBe(
      'medium',
    );
  });

  it('falls back to the first option when the preset default is invalid', () => {
    const broken = {
      effortSelector: { field: 'effort' as EffortField, options: ['low', 'high'] as EffortValue[] },
      preset: { effort: 'nope' },
    };
    expect(resolveEffortConfig(broken, {})?.selectedValue).toBe('low');
  });

  describe('model switching', () => {
    it('carries a supported value across effort families', () => {
      expect(resolveEffortConfig(byName('gpt-5.6-luna'), { effort: 'high' })?.selectedValue).toBe(
        'high',
      );
      expect(
        resolveEffortConfig(byName('glm-5'), { reasoning_effort: 'high' })?.selectedValue,
      ).toBe('high');
    });

    it('falls back when the carried value is unsupported', () => {
      expect(resolveEffortConfig(byName('gpt-5.6-luna'), { effort: 'max' })?.selectedValue).toBe(
        'medium',
      );
      expect(
        resolveEffortConfig(byName('sonnet-5'), { reasoning_effort: 'xhigh' })?.selectedValue,
      ).toBe('medium');
    });

    it('hides on Qwen and restores the value on return', () => {
      const params = { reasoning_effort: 'xhigh' };
      expect(resolveEffortConfig(byName('qwen3-vl'), params)).toBeNull();
      expect(resolveEffortConfig(byName('gpt-5.6-luna'), params)?.selectedValue).toBe('xhigh');
    });

    it('uses the new default when nothing is stored', () => {
      expect(resolveEffortConfig(byName('kimi-k2-5'), {})?.selectedValue).toBe('medium');
    });
  });
});

describe('findActiveModelSpec', () => {
  it('resolves by spec name', () => {
    expect(findActiveModelSpec(specs, { spec: 'glm-5' })?.name).toBe('glm-5');
  });

  it('resolves by exact endpoint and model', () => {
    expect(
      findActiveModelSpec(specs, { endpoint: 'Bedrock-OpenAI', model: 'openai.gpt-5.6-sol' })?.name,
    ).toBe('gpt-5.6-sol');
  });

  it('never resolves by label', () => {
    expect(findActiveModelSpec(specs, { spec: 'GLM-5' })).toBeUndefined();
  });

  it('does not match on endpoint alone', () => {
    expect(findActiveModelSpec(specs, { endpoint: 'bedrock' })).toBeUndefined();
  });
});

describe('effortSelector config validation', () => {
  const parse = (spec: unknown) => specsConfigSchema.safeParse({ list: [spec] });

  it('accepts a valid Claude selector and passes metadata through', () => {
    const result = parse(byName('opus-5'));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.list[0].effortSelector).toEqual({
        field: 'effort',
        options: CLAUDE_OPTIONS,
      });
    }
  });

  it('accepts specs without a selector', () => {
    expect(parse(byName('qwen3-vl')).success).toBe(true);
  });

  it.each([
    [
      'a preset default outside options',
      {
        name: 'bad-default',
        label: 'x',
        effortSelector: { field: 'reasoning_effort', options: OSS_OPTIONS },
        preset: { endpoint: 'bedrock', model: 'zai.glm-5', reasoning_effort: 'xhigh' },
      },
      'must be one of effortSelector.options',
    ],
    [
      'a missing preset default',
      {
        name: 'no-default',
        label: 'x',
        effortSelector: { field: 'effort', options: CLAUDE_OPTIONS },
        preset: { endpoint: 'bedrock', model: 'm' },
      },
      'must be set when effortSelector.field',
    ],
    [
      'duplicate options',
      {
        name: 'dupes',
        label: 'x',
        effortSelector: { field: 'effort', options: ['low', 'low'] },
        preset: { endpoint: 'bedrock', model: 'm', effort: 'low' },
      },
      'must not contain duplicates',
    ],
  ])('rejects %s', (_case, spec, message) => {
    const result = parse(spec);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes(message))).toBe(true);
    }
  });

  it('rejects an empty options list', () => {
    expect(
      parse({
        name: 'empty',
        label: 'x',
        effortSelector: { field: 'effort', options: [] },
        preset: { endpoint: 'bedrock', model: 'm', effort: 'low' },
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown field name', () => {
    expect(
      parse({
        name: 'bad-field',
        label: 'x',
        effortSelector: { field: 'thinkingEffort', options: ['low'] },
        preset: { endpoint: 'bedrock', model: 'm' },
      }).success,
    ).toBe(false);
  });
});

describe('resolveMetadataEffortConfig', () => {
  const LITELLM = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

  it('offers every level the gateway reports, in its order, on reasoning_effort', () => {
    const resolved = resolveMetadataEffortConfig(LITELLM, 'medium', {});
    expect(resolved).toEqual({
      field: 'reasoning_effort',
      options: LITELLM,
      defaultValue: 'medium',
      selectedValue: 'medium',
    });
  });

  it('renders nothing when the gateway reports no levels', () => {
    expect(resolveMetadataEffortConfig(undefined, 'medium', {})).toBeNull();
    expect(resolveMetadataEffortConfig(null, 'medium', {})).toBeNull();
    expect(resolveMetadataEffortConfig(['turbo'], 'medium', {})).toBeNull();
  });

  it('keeps a stored offered value and replaces one the model does not offer', () => {
    expect(
      resolveMetadataEffortConfig(['low', 'high'], 'low', { reasoning_effort: 'high' })
        ?.selectedValue,
    ).toBe('high');
    expect(
      resolveMetadataEffortConfig(['low', 'high'], 'low', { reasoning_effort: 'max' })
        ?.selectedValue,
    ).toBe('low');
  });

  it('selects nothing, rather than the weakest level, when the default is not offered', () => {
    const resolved = resolveMetadataEffortConfig(['none', 'low', 'high'], 'medium', {});
    expect(resolved?.defaultValue).toBeUndefined();
    expect(resolved?.selectedValue).toBeUndefined();
  });
});

describe('custom endpoint chatDefaults and models.metadata', () => {
  const base = { name: 'LiteLLM', apiKey: 'k', baseURL: 'http://x/v1' };

  it('accepts the LiteLLM integration settings', () => {
    const parsed = endpointSchema.parse({
      ...base,
      models: { default: ['Sonnet 5.5'], fetch: true, metadata: 'litellm' },
      chatDefaults: { webSearch: true, askUserQuestion: true, reasoningEffort: 'medium' },
    });
    expect(parsed.models.metadata).toBe('litellm');
    expect(parsed.chatDefaults?.reasoningEffort).toBe('medium');
  });

  it('rejects an unknown metadata source or effort', () => {
    const models = { default: ['m'] };
    expect(
      endpointSchema.safeParse({ ...base, models: { ...models, metadata: 'x' } }).success,
    ).toBe(false);
    expect(
      endpointSchema.safeParse({ ...base, models, chatDefaults: { reasoningEffort: 'turbo' } })
        .success,
    ).toBe(false);
  });
});
