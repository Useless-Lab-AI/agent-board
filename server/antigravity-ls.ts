import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { getAntigravitySummaries, type AntigravityRawQuestion } from './antigravity-meta.js';

const execFileAsync = promisify(execFile);

export interface AntigravityCredentials {
  address: string;
  csrfToken: string;
}

let cachedCredentials: AntigravityCredentials | null = null;
let lastCheckTime = 0;
let envCredsInvalidated = false;
let inflightPromise: Promise<AntigravityCredentials | null> | null = null;
const CACHE_TTL_MS = 120_000;

async function probeHttpPort(port: number, token: string): Promise<boolean> {
  const body = JSON.stringify({
    metadata: {
      ideName: 'antigravity',
      extensionName: 'antigravity',
      locale: 'en',
    },
  });

  return new Promise<boolean>((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/exa.language_server_pb.LanguageServerService/GetUserStatus',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Connect-Protocol-Version': '1',
          'X-Codeium-Csrf-Token': token,
        },
        timeout: 1500,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.write(body);
    req.end();
  });
}

async function discoverCredentialsInternal(
  runnerExe?: string,
): Promise<AntigravityCredentials | null> {
  const now = Date.now();

  try {
    if (process.platform === 'win32') {
      let pid = '';
      let token = '';

      // Try PowerShell CimInstance first (fast & supported on modern Windows 11 where wmic is deprecated)
      try {
        const psCmd = `Get-CimInstance Win32_Process -Filter "Name = 'language_server.exe'" | ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" }`;
        const { stdout: psOut } = await execFileAsync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', psCmd],
          { timeout: 8000, windowsHide: true },
        );
        for (const rawLine of psOut.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line) continue;
          const sepIdx = line.indexOf('|');
          if (sepIdx <= 0) continue;
          const candidatePid = line.slice(0, sepIdx).trim();
          const cmdLine = line.slice(sepIdx + 1);
          const tokenMatch = cmdLine.match(/--csrf_token(?:=|\s+)([^\s\r\n"']+)/i);
          if (candidatePid && tokenMatch) {
            pid = candidatePid;
            token = tokenMatch[1];
            break;
          }
        }
      } catch {
        // Fallback to wmic on older Windows environments
      }

      if (!pid || !token) {
        try {
          const { stdout: wmicOut } = await execFileAsync(
            'wmic',
            [
              'process',
              'where',
              "name='language_server.exe'",
              'get',
              'ProcessId,CommandLine',
              '/format:list',
            ],
            { timeout: 8000, windowsHide: true },
          );
          const pidMatch = wmicOut.match(/ProcessId=(\d+)/i);
          const tokenMatch = wmicOut.match(/--csrf_token(?:=|\s+)([^\s\r\n"']+)/i);
          if (pidMatch && tokenMatch) {
            pid = pidMatch[1];
            token = tokenMatch[1];
          }
        } catch {}
      }

      if (pid && token) {
        const { stdout: netstatOut } = await execFileAsync('netstat', ['-ano'], {
          timeout: 5000,
          windowsHide: true,
        });

        const portRegex = new RegExp(
          `TCP\\s+127\\.0\\.0\\.1:(\\d+)\\s+0\\.0\\.0\\.0:0\\s+LISTENING\\s+${pid}\\b`,
          'g',
        );
        const ports: number[] = [];
        let m: RegExpExecArray | null;
        while ((m = portRegex.exec(netstatOut)) !== null) {
          const p = Number(m[1]);
          if (!ports.includes(p)) ports.push(p);
        }

        // Sort ports descending (HTTP/gRPC Connect port is typically the higher port)
        ports.sort((a, b) => b - a);

        // 1. Probe HTTP Connect endpoint directly (fast & reliable across all callers)
        for (const port of ports) {
          if (await probeHttpPort(port, token)) {
            cachedCredentials = { address: `localhost:${port}`, csrfToken: token };
            lastCheckTime = Date.now();
            return cachedCredentials;
          }
        }

        // 2. Fallback to CLI probe if runnerExe is provided
        for (const port of ports) {
          const testAddr = `localhost:${port}`;
          if (!runnerExe) {
            cachedCredentials = { address: testAddr, csrfToken: token };
            lastCheckTime = now;
            return cachedCredentials;
          }

          try {
            const { stdout: testOut } = await execFileAsync(
              runnerExe,
              ['agentapi', 'get-conversation-metadata', 'probe-test'],
              {
                timeout: 2000,
                windowsHide: true,
                env: {
                  ...process.env,
                  ANTIGRAVITY_LS_ADDRESS: testAddr,
                  ANTIGRAVITY_CSRF_TOKEN: token,
                },
              },
            );

            if (
              testOut.includes('conversationMetadata') ||
              testOut.includes('NotFound') ||
              testOut.includes('not found') ||
              testOut.includes('PermissionDenied') ||
              testOut.includes('InvalidArgument') ||
              testOut.includes('response')
            ) {
              cachedCredentials = { address: testAddr, csrfToken: token };
              lastCheckTime = Date.now();
              return cachedCredentials;
            }
          } catch (e: any) {
            const out = String(e?.stdout ?? '');
            if (out && !out.includes('Unavailable') && !out.includes('EOF')) {
              cachedCredentials = { address: testAddr, csrfToken: token };
              lastCheckTime = Date.now();
              return cachedCredentials;
            }
          }
        }
      }
    } else {
      // macOS / Linux process inspection
      const { stdout: psOut } = await execFileAsync('ps', ['-eo', 'pid,args'], {
        timeout: 3000,
      });
      const lines = psOut.split('\n');
      for (const line of lines) {
        if (line.includes('language_server') && line.includes('--csrf_token')) {
          const tokenMatch = line.match(/--csrf_token(?:=|\s+)([^\s]+)/);
          const pidMatch = line.trim().match(/^(\d+)/);
          if (tokenMatch && pidMatch) {
            const pid = pidMatch[1];
            const token = tokenMatch[1];

            try {
              const { stdout: lsofOut } = await execFileAsync(
                'lsof',
                ['-Pan', '-p', pid, '-i', 'TCP', '-sTCP:LISTEN'],
                { timeout: 3000 },
              );
              const portMatches = [...lsofOut.matchAll(/:(\d+)\s+\(LISTEN\)/g)];
              const ports = portMatches.map((pm) => Number(pm[1])).sort((a, b) => b - a);

              for (const port of ports) {
                if (await probeHttpPort(port, token)) {
                  cachedCredentials = { address: `localhost:${port}`, csrfToken: token };
                  lastCheckTime = Date.now();
                  return cachedCredentials;
                }
              }

              if (ports.length > 0) {
                cachedCredentials = {
                  address: `localhost:${ports[0]}`,
                  csrfToken: token,
                };
                lastCheckTime = Date.now();
                return cachedCredentials;
              }
            } catch {}
          }
        }
      }
    }
  } catch {
    // Discovery failed or unsupported environment
  }

  return null;
}

export async function resolveAntigravityCredentials(
  runnerExe?: string,
): Promise<AntigravityCredentials | null> {
  // 1. Check cached credentials first
  const now = Date.now();
  if (cachedCredentials && now - lastCheckTime < CACHE_TTL_MS) {
    return cachedCredentials;
  }

  // 2. If explicit environment variables already set (e.g. running inside Antigravity terminal),
  // probe the HTTP endpoint once to ensure the port/token are not stale after a client restart.
  if (
    !envCredsInvalidated &&
    process.env.ANTIGRAVITY_LS_ADDRESS &&
    process.env.ANTIGRAVITY_CSRF_TOKEN
  ) {
    const [, portStr] = process.env.ANTIGRAVITY_LS_ADDRESS.split(':');
    const port = Number(portStr);
    if (port && (await probeHttpPort(port, process.env.ANTIGRAVITY_CSRF_TOKEN))) {
      cachedCredentials = {
        address: process.env.ANTIGRAVITY_LS_ADDRESS,
        csrfToken: process.env.ANTIGRAVITY_CSRF_TOKEN,
      };
      lastCheckTime = Date.now();
      return cachedCredentials;
    }
    envCredsInvalidated = true;
  }

  // 3. Deduplicate concurrent discovery calls
  if (!inflightPromise) {
    inflightPromise = discoverCredentialsInternal(runnerExe).finally(() => {
      inflightPromise = null;
    });
  }
  return inflightPromise;
}

export function invalidateAntigravityCredentialsCache(): void {
  cachedCredentials = null;
  lastCheckTime = 0;
  envCredsInvalidated = true;
}

function normalizeComparePath(p: string): string {
  if (!p || typeof p !== 'string') return '';
  try {
    const resolved = path.resolve(p.trim());
    const clean = resolved.replace(/[/\\]+$/, '');
    return process.platform === 'win32'
      ? clean.replace(/\//g, '\\').toLowerCase()
      : clean.replace(/\\/g, '/');
  } catch {
    return p.trim().toLowerCase();
  }
}

function uriToLocalPath(uri: string): string {
  if (!uri || typeof uri !== 'string') return '';
  const trimmed = uri.trim();
  if (!trimmed) return '';
  try {
    if (trimmed.startsWith('file://')) {
      return fileURLToPath(decodeURIComponent(trimmed));
    }
    return trimmed;
  } catch {
    return trimmed.replace(/^file:\/\/\/?/i, '');
  }
}

function localPathToFolderUri(localPath: string): string {
  const resolved = path.resolve(localPath);
  const rawHref = pathToFileURL(resolved).href;
  return rawHref.replace(
    /^file:\/\/\/([A-Za-z]):/,
    (_, d: string) => `file:///${d.toLowerCase()}%3A`,
  );
}

async function callLanguageServerRpc(
  creds: AntigravityCredentials,
  method: string,
  payload: Record<string, unknown> = {},
): Promise<any | null> {
  const [host, portStr] = creds.address.split(':');
  const port = Number(portStr);
  if (!host || !port) return null;

  const body = JSON.stringify({
    metadata: {
      ideName: 'antigravity',
      extensionName: 'antigravity',
      locale: 'en',
    },
    ...payload,
  });

  return new Promise<any | null>((resolve) => {
    const req = http.request(
      {
        hostname: host === 'localhost' ? '127.0.0.1' : host,
        port,
        path: `/exa.language_server_pb.LanguageServerService/${method}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Connect-Protocol-Version': '1',
          'X-Codeium-Csrf-Token': creds.csrfToken,
        },
        timeout: 2500,
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(buf));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}

function isValidModelEnum(val: unknown): val is string {
  return (
    typeof val === 'string' &&
    val.trim().length > 0 &&
    val !== 'MODEL_UNSPECIFIED' &&
    val !== 'UNSPECIFIED'
  );
}

export async function resolveCascadeConfigForMessage(
  creds: AntigravityCredentials,
  cascadeId: string,
): Promise<{
  cascadeConfig: Record<string, unknown>;
  customAgentSpec: Record<string, unknown>;
}> {
  let planModel = '';
  let autoExecutionPolicy = 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER';
  let artifactReviewMode = 'ARTIFACT_REVIEW_MODE_TURBO';
  let useAiCredits: boolean | undefined = undefined;

  // 1. Inspect conversation's generator metadata to preserve its existing model & tool settings
  const genMetaRes = await callLanguageServerRpc(
    creds,
    'GetCascadeTrajectoryGeneratorMetadata',
    {
      cascadeId,
      generatorMetadataOffset: 0,
    },
  );
  const genList: any[] = Array.isArray(genMetaRes?.generatorMetadata)
    ? genMetaRes.generatorMetadata
    : [];
  for (let i = genList.length - 1; i >= 0; i--) {
    const item = genList[i];
    if (!item || typeof item !== 'object') continue;
    const pc = item.plannerConfig;
    if (!planModel) {
      if (isValidModelEnum(pc?.planModel)) {
        planModel = pc.planModel;
      } else if (isValidModelEnum(pc?.requestedModel?.model)) {
        planModel = pc.requestedModel.model;
      } else if (isValidModelEnum(item.chatModel?.model)) {
        planModel = item.chatModel.model;
      }
    }
    const policy = pc?.toolConfig?.runCommand?.autoCommandConfig?.autoExecutionPolicy;
    if (typeof policy === 'string' && policy.trim()) {
      autoExecutionPolicy = policy.trim();
    }
    const reviewMode = pc?.toolConfig?.notifyUser?.artifactReviewMode;
    if (typeof reviewMode === 'string' && reviewMode.trim()) {
      artifactReviewMode = reviewMode.trim();
    }
    if (typeof pc?.useAiCredits === 'boolean' && useAiCredits === undefined) {
      useAiCredits = pc.useAiCredits;
    }
    if (planModel && pc) {
      break;
    }
  }

  // 2. Fallback to GetUserStatus defaultOverrideModelConfig / recommended clientModelConfigs
  if (!planModel) {
    const statusRes = await callLanguageServerRpc(creds, 'GetUserStatus');
    const modelData = statusRes?.userStatus?.cascadeModelConfigData;
    const defaultModel = modelData?.defaultOverrideModelConfig?.modelOrAlias?.model;
    if (isValidModelEnum(defaultModel)) {
      planModel = defaultModel;
    } else {
      const clientConfigs: any[] = Array.isArray(modelData?.clientModelConfigs)
        ? modelData.clientModelConfigs
        : [];
      const firstSortedLabel: string | undefined =
        modelData?.clientModelSorts?.[0]?.groups?.[0]?.modelLabels?.[0];
      if (firstSortedLabel) {
        const matched = clientConfigs.find((c) => c?.label === firstSortedLabel);
        if (isValidModelEnum(matched?.modelOrAlias?.model)) {
          planModel = matched.modelOrAlias.model;
        }
      }
      if (!planModel) {
        for (const c of clientConfigs) {
          if (isValidModelEnum(c?.modelOrAlias?.model)) {
            planModel = c.modelOrAlias.model;
            break;
          }
        }
      }
    }
  }

  // 3. Ultimate fallback to Gemini 4 Argon (High)
  if (!planModel) {
    planModel = 'MODEL_PLACEHOLDER_M418';
  }

  return {
    cascadeConfig: {
      plannerConfig: {
        planModel,
        supportsLatexRendering: true,
        ...(typeof useAiCredits === 'boolean' ? { useAiCredits } : {}),
        toolConfig: {
          runCommand: {
            autoCommandConfig: {
              autoExecutionPolicy,
            },
          },
          notifyUser: {
            artifactReviewMode,
          },
        },
      },
      conversationHistoryConfig: {
        enabled: false,
      },
      executorConfig: {
        useCoreDirect: true,
      },
    },
    customAgentSpec: {
      builtinAgent: {
        defaultAgent: {
          isGoogle: false,
          isInteractive: true,
          surface: 'AGENT_SURFACE_HUB',
        },
      },
    },
  };
}

export async function sendAntigravityUserMessage(
  creds: AntigravityCredentials,
  cascadeId: string,
  text: string,
): Promise<{ ok: boolean; error?: string; statusCode?: number }> {
  const [host, portStr] = creds.address.split(':');
  const port = Number(portStr);
  if (!host || !port) {
    return { ok: false, error: `Invalid LanguageServer address: ${creds.address}` };
  }

  const { cascadeConfig, customAgentSpec } = await resolveCascadeConfigForMessage(
    creds,
    cascadeId,
  );

  const body = JSON.stringify({
    metadata: {
      ideName: 'antigravity',
      extensionName: 'antigravity',
      locale: 'en',
    },
    cascadeId,
    items: [{ text }],
    cascadeConfig,
    customAgentSpec,
  });

  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: host === 'localhost' ? '127.0.0.1' : host,
        port,
        path: '/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Connect-Protocol-Version': '1',
          'X-Codeium-Csrf-Token': creds.csrfToken,
        },
        timeout: 20000,
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve({ ok: true, statusCode: 200 });
            return;
          }
          let errMsg = buf.trim();
          try {
            const parsed = JSON.parse(buf);
            if (parsed?.message) errMsg = String(parsed.message);
            else if (parsed?.error) errMsg = String(parsed.error);
          } catch {}
          resolve({
            ok: false,
            statusCode: res.statusCode,
            error: errMsg || `HTTP ${res.statusCode}`,
          });
        });
      },
    );
    req.on('error', (err) => {
      resolve({ ok: false, error: err.message || 'connection error' });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.write(body);
    req.end();
  });
}

export interface AntigravityActiveAskQuestionStep {
  trajectoryId: string;
  stepIndex: number;
  title: string;
  rawQuestions: AntigravityRawQuestion[];
}

export async function getAntigravityPendingAskQuestionStep(
  creds: AntigravityCredentials,
  cascadeId: string,
  stepOffsetHint = 0,
): Promise<
  | { status: 'waiting'; step: AntigravityActiveAskQuestionStep }
  | { status: 'completed' }
  | { status: 'none' }
  | { status: 'unreachable' }
> {
  const offset = Math.max(0, stepOffsetHint - 1);
  const res = await callLanguageServerRpc(creds, 'GetCascadeTrajectorySteps', {
    cascadeId,
    stepOffset: offset,
  });
  if (!res) {
    return { status: 'unreachable' };
  }
  const steps: any[] = Array.isArray(res.steps) ? res.steps : [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (!step || step.type !== 'CORTEX_STEP_TYPE_ASK_QUESTION') continue;
    if (step.status !== 'CORTEX_STEP_STATUS_WAITING') {
      return { status: 'completed' };
    }
    const info = step.metadata?.sourceTrajectoryStepInfo;
    const trajectoryId = typeof info?.trajectoryId === 'string' ? info.trajectoryId : '';
    const stepIndex =
      typeof info?.stepIndex === 'number' && Number.isInteger(info.stepIndex)
        ? info.stepIndex
        : offset + i;
    const title =
      (typeof step.metadata?.toolSummary === 'string' && step.metadata.toolSummary.trim()) ||
      (typeof step.metadata?.toolAction === 'string' && step.metadata.toolAction.trim()) ||
      'AI 需要你的回答';

    const qList: any[] = Array.isArray(step.requestedInteraction?.askQuestion?.questions)
      ? step.requestedInteraction.askQuestion.questions
      : [];
    const rawQuestions: AntigravityRawQuestion[] = [];
    for (const q of qList) {
      if (!q || typeof q !== 'object') continue;
      const question = typeof q.question === 'string' ? q.question.trim() : '';
      if (!question) continue;
      const isMultiSelect = Boolean(q.isMultiSelect ?? q.is_multi_select ?? q.multiple);
      const optsRaw = Array.isArray(q.options) ? q.options : [];
      const options: Array<{ id: string; text: string }> = [];
      for (let idx = 0; idx < optsRaw.length; idx++) {
        const o = optsRaw[idx];
        if (typeof o === 'string' && o.trim()) {
          options.push({ id: String(idx + 1), text: o.trim() });
        } else if (o && typeof o === 'object') {
          const text = String(o.text ?? o.label ?? '').trim();
          if (text) {
            options.push({ id: String(o.id ?? idx + 1), text });
          }
        }
      }
      rawQuestions.push({
        question,
        isMultiSelect,
        options,
      });
    }
    if (rawQuestions.length === 0) {
      return { status: 'none' };
    }
    return {
      status: 'waiting',
      step: {
        trajectoryId,
        stepIndex,
        title,
        rawQuestions,
      },
    };
  }
  return { status: 'none' };
}

export interface AntigravityAskQuestionSubmission {
  trajectoryId: string;
  stepIndex: number;
  responses: Array<{
    question: string;
    options: Array<{ id: string; text: string }>;
    isMultiSelect: boolean;
    selectedOptionIds?: string[];
    writeInResponse?: string;
    skipped?: boolean;
  }>;
  cancelled?: boolean;
}

export async function submitAntigravityAskQuestion(
  creds: AntigravityCredentials,
  cascadeId: string,
  submission: AntigravityAskQuestionSubmission,
): Promise<{ ok: boolean; error?: string; statusCode?: number }> {
  const [host, portStr] = creds.address.split(':');
  const port = Number(portStr);
  if (!host || !port) {
    return { ok: false, error: `Invalid LanguageServer address: ${creds.address}` };
  }

  const body = JSON.stringify({
    metadata: {
      ideName: 'antigravity',
      extensionName: 'antigravity',
      locale: 'en',
    },
    cascadeId,
    interaction: {
      ...(submission.trajectoryId ? { trajectoryId: submission.trajectoryId } : {}),
      stepIndex: submission.stepIndex,
      askQuestion: {
        responses: submission.responses,
        cancelled: Boolean(submission.cancelled),
      },
    },
  });

  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: host === 'localhost' ? '127.0.0.1' : host,
        port,
        path: '/exa.language_server_pb.LanguageServerService/HandleCascadeUserInteraction',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Connect-Protocol-Version': '1',
          'X-Codeium-Csrf-Token': creds.csrfToken,
        },
        timeout: 15000,
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve({ ok: true, statusCode: 200 });
            return;
          }
          let errMsg = buf.trim();
          try {
            const parsed = JSON.parse(buf);
            if (parsed?.message) errMsg = String(parsed.message);
            else if (parsed?.error) errMsg = String(parsed.error);
          } catch {}
          resolve({
            ok: false,
            statusCode: res.statusCode,
            error: errMsg || `HTTP ${res.statusCode}`,
          });
        });
      },
    );
    req.on('error', (err) => {
      resolve({ ok: false, error: err.message || 'connection error' });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.write(body);
    req.end();
  });
}

export async function resolveAntigravityProjectId(
  targetCwd: string,
  antigravityHome: string,
  creds?: AntigravityCredentials | null,
): Promise<string | null> {
  const candidates: Array<{ projectId: string; folderPath: string }> = [];
  const seenProjectIds = new Set<string>();

  const collectFromProjectObj = (proj: any) => {
    if (!proj || typeof proj.id !== 'string' || !proj.id) return;
    seenProjectIds.add(proj.id);
    if (proj.id === 'outside-of-project') return;
    const resources = proj.projectResources?.resources;
    if (!Array.isArray(resources)) return;
    for (const res of resources) {
      const fUri = res?.folderUri || res?.gitFolder?.folderUri;
      if (typeof fUri === 'string' && fUri.trim()) {
        const localPath = uriToLocalPath(fUri);
        if (localPath) {
          candidates.push({ projectId: proj.id, folderPath: localPath });
        }
      }
    }
  };

  // 1. Read local ~/.gemini/config/projects/*.json files
  const configDirs = Array.from(
    new Set([
      antigravityHome ? path.join(path.dirname(antigravityHome), 'config', 'projects') : '',
      path.join(os.homedir(), '.gemini', 'config', 'projects'),
    ]),
  ).filter(Boolean);

  for (const dir of configDirs) {
    try {
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir)) {
        if (!entry.endsWith('.json')) continue;
        try {
          const parsed = JSON.parse(readFileSync(path.join(dir, entry), 'utf8'));
          collectFromProjectObj(parsed);
        } catch {}
      }
    } catch {}
  }

  // 2. Query live LanguageServer ListProjects + ReadProjects if credentials available
  if (creds) {
    try {
      const listRes = await callLanguageServerRpc(creds, 'ListProjects');
      const ids: string[] = Array.isArray(listRes?.projectIds) ? listRes.projectIds : [];
      for (const id of ids) {
        if (typeof id === 'string' && id) seenProjectIds.add(id);
      }
      if (ids.length > 0) {
        const readRes = await callLanguageServerRpc(creds, 'ReadProjects', { ids });
        const projects: any[] = Array.isArray(readRes?.projects) ? readRes.projects : [];
        for (const p of projects) {
          collectFromProjectObj(p);
        }
      }
    } catch {}
  }

  // 3. Also check conversation_summaries.db for historical workspace -> projectId mappings
  if (antigravityHome) {
    try {
      const summaries = getAntigravitySummaries(antigravityHome);
      for (const s of summaries.values()) {
        if (s.projectId) {
          seenProjectIds.add(s.projectId);
          if (s.projectId !== 'outside-of-project' && s.cwd) {
            candidates.push({ projectId: s.projectId, folderPath: s.cwd });
          }
        }
      }
    } catch {}
  }

  // 4. Match targetCwd against collected candidates
  const targetNorm = normalizeComparePath(targetCwd);
  if (targetNorm) {
    const sep = process.platform === 'win32' ? '\\' : '/';
    // 4a. Exact match
    for (const c of candidates) {
      if (normalizeComparePath(c.folderPath) === targetNorm) {
        return c.projectId;
      }
    }

    // 4b. Target is a subdirectory of a registered project (pick longest parent path)
    let bestParent: { projectId: string; len: number } | null = null;
    for (const c of candidates) {
      const cNorm = normalizeComparePath(c.folderPath);
      if (cNorm && targetNorm.startsWith(cNorm + sep)) {
        if (!bestParent || cNorm.length > bestParent.len) {
          bestParent = { projectId: c.projectId, len: cNorm.length };
        }
      }
    }
    if (bestParent) {
      return bestParent.projectId;
    }

    // 4c. Target is a parent directory of a registered project
    let bestChild: { projectId: string; len: number } | null = null;
    for (const c of candidates) {
      const cNorm = normalizeComparePath(c.folderPath);
      if (cNorm && cNorm.startsWith(targetNorm + sep)) {
        if (!bestChild || cNorm.length < bestChild.len) {
          bestChild = { projectId: c.projectId, len: cNorm.length };
        }
      }
    }
    if (bestChild) {
      return bestChild.projectId;
    }
  }

  // 5. If targetCwd is a valid directory not yet registered as a project in Antigravity, register it via CreateProject
  if (creds && targetCwd && existsSync(targetCwd)) {
    try {
      const newProjectId = randomUUID();
      const folderName = path.basename(path.resolve(targetCwd)) || 'workspace';
      const createRes = await callLanguageServerRpc(creds, 'CreateProject', {
        project: {
          id: newProjectId,
          name: folderName,
          projectResources: {
            resources: [
              {
                folderUri: localPathToFolderUri(targetCwd),
              },
            ],
          },
          settings: {},
          isWorkspaceOnly: false,
        },
      });
      if (createRes !== null) {
        return newProjectId;
      }
    } catch {}
  }

  // 6. Fallback to env or any existing project ID
  if (process.env.ANTIGRAVITY_PROJECT_ID) {
    return process.env.ANTIGRAVITY_PROJECT_ID;
  }
  for (const pid of seenProjectIds) {
    if (pid !== 'outside-of-project') return pid;
  }
  if (seenProjectIds.has('outside-of-project')) {
    return 'outside-of-project';
  }
  return null;
}
