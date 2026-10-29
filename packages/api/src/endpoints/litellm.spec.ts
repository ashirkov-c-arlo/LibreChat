import http from 'http';
import type { AddressInfo } from 'net';
import type { TokenomicsDeps } from '~/endpoints/pricing';
import type { EndpointTokenConfig } from '~/types';
import {
  getReasoningEfforts,
  processLiteLLMModelGroups,
  getLiteLLMModelGroupInfoURL,
} from '~/endpoints/litellm';
import { buildTokenConfigMap } from '~/endpoints/pricing';
import { fetchModels } from '~/endpoints/models';
import { tokenConfigCache } from '~/cache';

/** Trimmed from a live LiteLLM 1.106.2 `/model_group/info` response. */
const groups = [
  {
    model_group: 'GPT 6 Luna',
    providers: ['openai'],
    mode: 'responses',
    max_input_tokens: 1050000,
    max_output_tokens: 128000,
    input_cost_per_token: 2.2e-7,
    output_cost_per_token: 8.25e-7,
    supports_reasoning: true,
    supported_reasoning_efforts: null,
  },
  {
    model_group: 'Sonnet 5.5',
    providers: ['bedrock'],
    mode: 'chat',
    max_input_tokens: 1000000,
    max_output_tokens: 128000,
    input_cost_per_token: 0.000002,
    output_cost_per_token: 0.00001,
    supports_reasoning: true,
    supported_reasoning_efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    model_group: 'Qwen3 32B',
    providers: ['bedrock'],
    mode: 'chat',
    max_input_tokens: 32000,
    max_output_tokens: 8000,
    input_cost_per_token: 1.545e-7,
    output_cost_per_token: 6.18e-7,
    supports_reasoning: true,
    supported_reasoning_efforts: null,
  },
];

let server: http.Server;
let baseURL: string;
let groupStatus = 200;
let groupList = groups;
const hits: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(`${req.url} ${req.headers.authorization}`);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/models') {
      res.end(JSON.stringify({ data: groupList.map(({ model_group }) => ({ id: model_group })) }));
      return;
    }
    if (req.url === '/model_group/info') {
      res.statusCode = groupStatus;
      res.end(groupStatus === 200 ? JSON.stringify({ data: groupList }) : '{"error":"boom"}');
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(async () => {
  hits.length = 0;
  groupStatus = 200;
  groupList = groups;
  await tokenConfigCache().clear();
});

const deps: TokenomicsDeps = {
  getValueKey: () => undefined,
  getMultiplier: () => 1,
  getCacheMultiplier: () => null,
};

const fetchLiteLLM = (tokenKey: string, metadata?: 'litellm') =>
  fetchModels({
    name: 'LiteLLM',
    apiKey: 'sk-test',
    baseURL,
    tokenKey,
    skipCache: true,
    metadata,
  });

describe('processLiteLLMModelGroups', () => {
  it('maps input/output limits, prices and reported efforts per public name', () => {
    const config = processLiteLLMModelGroups({ data: groups });
    expect(config['Sonnet 5.5']).toMatchObject({
      context: 1000000,
      output: 128000,
      prompt: 2,
      completion: 10,
    });
    expect(config['Qwen3 32B']).toMatchObject({ context: 32000, output: 8000 });
    expect(getReasoningEfforts(config['Sonnet 5.5'])).toEqual(
      groups[1].supported_reasoning_efforts,
    );
  });

  it('treats null efforts as unknown, not as a level list', () => {
    const config = processLiteLLMModelGroups({ data: groups });
    expect(getReasoningEfforts(config['GPT 6 Luna'])).toBeUndefined();
    expect(getReasoningEfforts(config['Qwen3 32B'])).toBeUndefined();
  });

  it('omits unreported fields and skips malformed entries', () => {
    const config = processLiteLLMModelGroups({
      data: [{ model_group: 'Bare' }, { model_group: 7 }, { max_input_tokens: 5 }],
    });
    expect(config).toEqual({ Bare: {} });
  });

  it('rejects a response that is not a model list', () => {
    expect(() => processLiteLLMModelGroups({ error: 'x' })).toThrow();
  });

  it('derives the root catalog URL from an OpenAI-style base URL', () => {
    expect(getLiteLLMModelGroupInfoURL('http://h:4000/v1/')).toBe('http://h:4000/model_group/info');
    expect(getLiteLLMModelGroupInfoURL('http://h:4000')).toBe('http://h:4000/model_group/info');
  });
});

describe('fetchModels with customParams.modelCatalog: litellm', () => {
  it('lists public names and caches their metadata with the endpoint key', async () => {
    const models = await fetchLiteLLM('LiteLLM', 'litellm');
    expect(models).toEqual(['GPT 6 Luna', 'Sonnet 5.5', 'Qwen3 32B']);
    /** Both requests carry the endpoint key; they run in parallel, so order is free */
    expect(hits.sort()).toEqual(['/model_group/info Bearer sk-test', '/v1/models Bearer sk-test']);

    const config = (await tokenConfigCache().get('LiteLLM')) as EndpointTokenConfig;
    expect(config['GPT 6 Luna'].context).toBe(1050000);
    expect(config['Qwen3 32B'].context).toBe(32000);
  });

  it('keeps the model list when the metadata endpoint fails', async () => {
    groupStatus = 500;
    const models = await fetchLiteLLM('LiteLLM', 'litellm');
    expect(models).toEqual(['GPT 6 Luna', 'Sonnet 5.5', 'Qwen3 32B']);
    expect(await tokenConfigCache().get('LiteLLM')).toBeUndefined();
  });

  it('picks up a model added in LiteLLM on the next uncached fetch', async () => {
    await fetchLiteLLM('LiteLLM', 'litellm');
    groupList = [...groups, { ...groups[2], model_group: 'New Model', max_input_tokens: 64000 }];
    const models = await fetchLiteLLM('LiteLLM', 'litellm');
    expect(models).toContain('New Model');
    const config = (await tokenConfigCache().get('LiteLLM')) as EndpointTokenConfig;
    expect(config['New Model'].context).toBe(64000);
  });

  it('does not query the catalog for a plain OpenAI-compatible endpoint', async () => {
    const models = await fetchLiteLLM('Plain');
    expect(models).toHaveLength(3);
    expect(hits).toEqual(['/v1/models Bearer sk-test']);
    expect(await tokenConfigCache().get('Plain')).toBeUndefined();
  });
});

describe('buildTokenConfigMap with metadata endpoints', () => {
  const override = processLiteLLMModelGroups({ data: groups });
  const modelsConfig = { LiteLLM: ['Sonnet 5.5', 'Qwen3 32B', 'GPT 6 Luna', 'Grok 4.7'] };

  it('serves reported limits and efforts, and nothing invented for the rest', () => {
    const map = buildTokenConfigMap(
      {
        modelsConfig,
        endpointTokenConfigs: { LiteLLM: override },
        metadataEndpoints: new Set(['LiteLLM']),
      },
      deps,
    );
    expect(map.LiteLLM['Sonnet 5.5']).toEqual({
      context: 1000000,
      reasoningEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    });
    expect(map.LiteLLM['Qwen3 32B']).toEqual({ context: 32000 });
    expect(map.LiteLLM['GPT 6 Luna']).toEqual({ context: 1050000 });
    /** `grok` is a built-in name pattern; a metadata endpoint must not fall back to it */
    expect(map.LiteLLM['Grok 4.7']).toEqual({});
  });

  it('keeps name-pattern fallback for endpoints without metadata', () => {
    const map = buildTokenConfigMap(
      { modelsConfig: { Other: ['grok-4'] }, endpointTokenConfigs: {} },
      deps,
    );
    expect(map.Other['grok-4'].context).toBeGreaterThan(0);
  });
});
