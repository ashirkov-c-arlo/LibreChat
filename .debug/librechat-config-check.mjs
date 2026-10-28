// Prints the LibreChat config sections relevant to the LiteLLM migration, secrets redacted.
// Run on the LibreChat LXC:
//   cd /opt/librechat && node /tmp/librechat-config-check.mjs [/opt/librechat/librechat.yaml]
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(`${process.cwd()}/package.json`);
const yaml = require('js-yaml');
const path = process.argv[2] ?? process.env.CONFIG_PATH ?? 'librechat.yaml';
const config = yaml.load(fs.readFileSync(path, 'utf8')) ?? {};

const SECRET = /key|secret|token|password|credential|authorization/i;
const redact = (value, key = '') => {
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  }
  if (SECRET.test(key) && typeof value === 'string') {
    return value.startsWith('${') ? value : '<redacted>';
  }
  return value;
};
const show = (title, value) => console.log(`\n=== ${title} ===\n${yaml.dump(redact(value ?? null))}`);

console.log('file:', path, '| version:', config.version);
show('memory', config.memory);
show('interface', config.interface);
show('endpoints.agents', config.endpoints?.agents);
show('endpoints.custom', config.endpoints?.custom);
show('other endpoints', Object.keys(config.endpoints ?? {}).filter((k) => k !== 'custom'));
show(
  'modelSpecs (summary)',
  config.modelSpecs && {
    ...config.modelSpecs,
    list: (config.modelSpecs.list ?? []).map((s) => ({
      name: s.name,
      endpoint: s.preset?.endpoint,
      model: s.preset?.model,
      webSearch: s.webSearch,
      executeCode: s.executeCode,
      memory: s.memory,
      askUserQuestion: s.askUserQuestion,
      effortSelector: s.effortSelector,
    })),
  },
);
show('webSearch (keys only)', config.webSearch && Object.keys(config.webSearch));

const env = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
const envNames = ['ENDPOINTS', 'CONFIG_PATH', 'LITELLM_BASE_URL', 'LITELLM_API_KEY'];
console.log('\n=== .env (presence only) ===');
for (const name of envNames) {
  const line = env.split('\n').find((l) => l.startsWith(`${name}=`));
  const value = line?.slice(name.length + 1);
  const shown = name === 'ENDPOINTS' ? value : value ? '<set>' : '<unset>';
  console.log(`${name}=${shown ?? '<unset>'}`);
}
