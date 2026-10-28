// Read-only + 4 tiny chat calls. Prints shapes, never keys/headers.
// Run on the LibreChat LXC:
//   cd /opt/librechat && node -r dotenv/config /tmp/litellm-probe.mjs dotenv_config_path=/opt/librechat/.env
const KEY = process.env.LITELLM_API_KEY;
const BASE = (process.env.LITELLM_BASE_URL || '').replace(/\/+$/, '');
if (!KEY || !BASE) {
  console.error('LITELLM_API_KEY / LITELLM_BASE_URL not set');
  process.exit(1);
}
const ROOT = BASE.replace(/\/v1$/, '');
const auth = { Authorization: `Bearer ${KEY}` };
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

async function get(url) {
  try {
    const res = await fetch(url, { headers: auth, signal: AbortSignal.timeout(10000) });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, json };
  } catch (e) {
    return { status: 'ERR ' + (e.cause?.code ?? e.name) };
  }
}

const section = (t) => console.log(`\n=== ${t} ===`);

section('version');
const ready = await get(`${ROOT}/health/readiness`);
console.log(ready.status, pick(ready.json ?? {}, ['status', 'litellm_version']));

section('GET /v1/models');
const models = await get(`${BASE}/models`);
console.log('status', models.status);
for (const m of models.json?.data ?? []) {
  console.log(JSON.stringify(m));
}

section('GET /model_group/info (same key)');
const groups = await get(`${ROOT}/model_group/info`);
console.log('status', groups.status);
const groupFields = [
  'model_group', 'providers', 'mode', 'max_input_tokens', 'max_output_tokens',
  'input_cost_per_token', 'output_cost_per_token', 'supports_reasoning',
  'supported_reasoning_efforts', 'supports_function_calling', 'supports_vision',
];
for (const g of groups.json?.data ?? []) {
  console.log(JSON.stringify(pick(g, groupFields)));
}
if (groups.json?.data?.[0]) {
  console.log('all keys:', Object.keys(groups.json.data[0]).join(','));
}

section('GET /model/info (same key, selected fields only)');
const info = await get(`${ROOT}/model/info`);
console.log('status', info.status);
for (const d of info.json?.data ?? []) {
  console.log(
    JSON.stringify({
      model_name: d.model_name,
      model: d.litellm_params?.model,
      reasoning_effort: d.litellm_params?.reasoning_effort,
      model_info: pick(d.model_info ?? {}, [
        'mode', 'max_input_tokens', 'max_output_tokens', 'max_tokens', 'supports_reasoning',
        'reasoning_effort_levels', 'supported_endpoints', 'supports_function_calling',
      ]),
    }),
  );
}

/** Streams one chat completion with a required tool call; prints only shape. */
async function chat(model, { stream, effort }) {
  const body = {
    model,
    stream,
    max_tokens: 512,
    messages: [{ role: 'user', content: 'Call get_time for Berlin. Do not answer in text.' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_time',
          description: 'Current time in a city',
          parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
        },
      },
    ],
    ...(effort ? { reasoning_effort: effort } : {}),
  };
  const label = `${model} stream=${stream} effort=${effort ?? '-'}`;
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    const text = await res.text();
    if (!res.ok) {
      console.log(label, 'HTTP', res.status, text.slice(0, 300));
      return;
    }
    if (!stream) {
      const j = JSON.parse(text);
      const c = j.choices?.[0];
      console.log(label, {
        finish: c?.finish_reason,
        tools: c?.message?.tool_calls?.map((t) => t.function?.name),
        reasoning: Boolean(c?.message?.reasoning_content),
        usage: pick(j.usage ?? {}, ['prompt_tokens', 'completion_tokens']),
      });
      return;
    }
    let chunks = 0, toolArgs = '', toolName, finish, reasoning = false;
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      const c = JSON.parse(line.slice(6)).choices?.[0];
      chunks++;
      const tc = c?.delta?.tool_calls?.[0];
      if (tc?.function?.name) toolName = tc.function.name;
      if (tc?.function?.arguments) toolArgs += tc.function.arguments;
      if (c?.delta?.reasoning_content) reasoning = true;
      if (c?.finish_reason) finish = c.finish_reason;
    }
    console.log(label, { chunks, toolName, toolArgs, finish, reasoning });
  } catch (e) {
    console.log(label, 'ERR', e.name);
  }
}

section('chat/completions: tools, streaming and non-streaming');
for (const model of process.argv.slice(2).filter((a) => !a.startsWith('dotenv_')).length
  ? process.argv.slice(2).filter((a) => !a.startsWith('dotenv_'))
  : ['GPT 6 Luna', 'Haiku 5.5']) {
  await chat(model, { stream: true, effort: 'low' });
  await chat(model, { stream: false });
}
