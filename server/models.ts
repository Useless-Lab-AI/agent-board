import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Provider } from '../shared/types.js';
import {
  resolveAntigravityCredentials,
  invalidateAntigravityCredentialsCache,
} from './antigravity-ls.js';

export interface ModelOption {
  value: string;
  label: string;
  description?: string;
}

export const DEFAULT_AGENT_MODELS: Record<Provider, ModelOption[]> = {
  antigravity: [
    { value: 'Gemini 4 Argon', label: 'Gemini 4 Argon' },
    { value: 'Gemini 3.8 Flash', label: 'Gemini 3.8 Flash' },
    { value: 'Claude Opus 5.5', label: 'Claude Opus 5.5' },
    { value: 'Claude Sonnet 5.5', label: 'Claude Sonnet 5.5' },
    { value: 'GPT-OSS 120B (Medium)', label: 'GPT-OSS 120B (Medium)' },
  ],
  claude: [
    { value: '', label: 'Default (recommended)' },
    { value: 'opus', label: 'Opus (Opus 5.5)' },
    { value: 'fable', label: 'Fable (Fable 5.1)' },
    { value: 'sonnet', label: 'Sonnet (Sonnet 5.5)' },
    { value: 'haiku', label: 'Haiku (Haiku 5.5)' },
  ],
  codex: [
    { value: '', label: 'Default (config)' },
    { value: 'gpt-6-astra', label: 'gpt-6-astra' },
    { value: 'gpt-6.1-sol', label: 'gpt-6.1-sol' },
    { value: 'o3', label: 'o3' },
    { value: 'o3-mini', label: 'o3-mini' },
    { value: 'o1', label: 'o1' },
    { value: 'gpt-4o', label: 'gpt-4o' },
  ],
};

let cachedAntigravityModels: ModelOption[] | null = null;
let lastAgCheck = 0;
const AG_CHECK_TTL_MS = 60_000;

async function requestUserStatus(address: string, csrfToken: string): Promise<string> {
  const [host, port] = address.split(':');
  const body = JSON.stringify({
    metadata: {
      ideName: 'antigravity',
      extensionName: 'antigravity',
      locale: 'en',
    },
  });

  return new Promise<string>((resolve, reject) => {
    const req = http.request(
      {
        hostname: host,
        port: Number(port),
        path: '/exa.language_server_pb.LanguageServerService/GetUserStatus',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Connect-Protocol-Version': '1',
          'X-Codeium-Csrf-Token': csrfToken,
        },
        timeout: 2500,
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          if (res.statusCode === 200) resolve(buf);
          else reject(new Error(`HTTP ${res.statusCode}`));
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.write(body);
    req.end();
  });
}

async function fetchAntigravityLiveModels(): Promise<ModelOption[] | null> {
  const now = Date.now();
  if (cachedAntigravityModels && now - lastAgCheck < AG_CHECK_TTL_MS) {
    return cachedAntigravityModels;
  }

  try {
    let creds = await resolveAntigravityCredentials();
    if (!creds) return null;

    let data: string;
    try {
      data = await requestUserStatus(creds.address, creds.csrfToken);
    } catch {
      invalidateAntigravityCredentialsCache();
      creds = await resolveAntigravityCredentials();
      if (!creds) return null;
      data = await requestUserStatus(creds.address, creds.csrfToken);
    }

    const parsed = JSON.parse(data);
    const cascade = parsed?.userStatus?.cascadeModelConfigData;
    const configs: Array<{ label?: string; modelId?: string }> =
      cascade?.clientModelConfigs || [];
    const sortedLabels: string[] =
      cascade?.clientModelSorts?.[0]?.groups?.flatMap(
        (g: { modelLabels?: string[] }) => g.modelLabels || [],
      ) || [];

    const allLabels = [
      ...sortedLabels,
      ...configs.map((c) => c.label).filter((l): l is string => !!l),
    ];

    if (allLabels.length > 0) {
      const baseCounts = new Map<string, number>();
      const uniqueFullLabels = new Set<string>(allLabels);
      for (const label of uniqueFullLabels) {
        const baseName = label.replace(/\s*\((High|Medium|Low)\)\s*$/, '').trim();
        baseCounts.set(baseName, (baseCounts.get(baseName) || 0) + 1);
      }

      const seen = new Set<string>();
      const list: ModelOption[] = [];
      for (const rawLabel of allLabels) {
        if (!rawLabel) continue;
        const baseName = rawLabel.replace(/\s*\((High|Medium|Low)\)\s*$/, '').trim();
        const displayName = (baseCounts.get(baseName) || 0) > 1 ? baseName : rawLabel.trim();
        if (!seen.has(displayName)) {
          seen.add(displayName);
          list.push({ value: displayName, label: displayName });
        }
      }
      if (list.length > 0) {
        cachedAntigravityModels = list;
        lastAgCheck = Date.now();
        return list;
      }
    }
  } catch {}

  return null;
}

function getCodexModels(): ModelOption[] {
  const defaults = [...DEFAULT_AGENT_MODELS.codex];
  try {
    const configPath = path.join(os.homedir(), '.codex', 'config.toml');
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf8');
      const mMatch = content.match(/^model\s*=\s*"([^"]+)"/m);
      if (mMatch && mMatch[1]) {
        const configured = mMatch[1];
        if (!defaults.some((d) => d.value === configured)) {
          defaults.splice(1, 0, { value: configured, label: configured });
        }
      }
    }
  } catch {}
  return defaults;
}

export async function getAvailableModels(): Promise<Record<Provider, ModelOption[]>> {
  const liveAgModels = await fetchAntigravityLiveModels();
  return {
    antigravity: liveAgModels && liveAgModels.length > 0 ? liveAgModels : DEFAULT_AGENT_MODELS.antigravity,
    claude: DEFAULT_AGENT_MODELS.claude,
    codex: getCodexModels(),
  };
}
