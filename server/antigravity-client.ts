import { execFile } from 'node:child_process';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { NativeSession } from './discovery.js';
import type { LiveClient, LiveState } from './live-client.js';
import { getAntigravitySummaries, getAntigravityExecution } from './antigravity-meta.js';
import {
  resolveAntigravityCredentials,
  invalidateAntigravityCredentialsCache,
} from './antigravity-ls.js';

export interface ApiRunner {
  exe: string;
  argsPrefix: string[];
  shell?: boolean;
}

let cachedRunner: ApiRunner | null | undefined = undefined;

export async function getAgentApiRunner(antigravityHome: string): Promise<ApiRunner | null> {
  if (cachedRunner !== undefined) return cachedRunner;

  // In test environment with isolated custom AGENT_BOARD_ANTIGRAVITY_HOME
  if (process.env.AGENT_BOARD_ANTIGRAVITY_HOME) {
    const batPath = path.join(antigravityHome, 'bin', 'agentapi.bat');
    if (existsSync(batPath)) {
      cachedRunner = { exe: batPath, argsPrefix: [], shell: true };
      return cachedRunner;
    }
    cachedRunner = null;
    return null;
  }

  // 1. Try reading the path to language_server.exe from agentapi.bat
  const batPath = path.join(antigravityHome, 'bin', 'agentapi.bat');
  try {
    if (existsSync(batPath)) {
      const content = await readFile(batPath, 'utf8');
      const match = content.match(/"([^"]+language_server\.exe)"/i);
      if (match && existsSync(match[1])) {
        cachedRunner = { exe: match[1], argsPrefix: ['agentapi'] };
        return cachedRunner;
      }
    }
  } catch {}

  // 2. Try default install directory of language_server.exe
  const localAppData =
    process.env.LOCALAPPDATA ||
    (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : '');
  if (localAppData) {
    const defaultExe = path.join(
      localAppData,
      'Programs',
      'antigravity',
      'resources',
      'bin',
      'language_server.exe',
    );
    if (existsSync(defaultExe)) {
      cachedRunner = { exe: defaultExe, argsPrefix: ['agentapi'] };
      return cachedRunner;
    }
  }

  // 3. Fallback to executing agentapi.bat directly with shell
  if (existsSync(batPath)) {
    cachedRunner = { exe: batPath, argsPrefix: [], shell: true };
    return cachedRunner;
  }

  cachedRunner = null;
  return null;
}

export class AntigravityClient implements LiveClient {
  private epoch = randomUUID();
  private onUpdateCallback?: () => void;
  private watcher?: FSWatcher;
  private watchTimer?: NodeJS.Timeout;
  private transcriptPath?: string;
  private justSentAt = 0;

  constructor(
    private session: NativeSession,
    private antigravityHome: string,
  ) {
    this.ensureWatcher();
  }

  private getTranscriptPath(): string {
    if (this.transcriptPath) return this.transcriptPath;
    const fromFiles = this.session.files?.find((f) => f.path.endsWith('transcript.jsonl'))?.path;
    this.transcriptPath =
      fromFiles ??
      path.join(
        this.antigravityHome,
        'brain',
        this.session.nativeId,
        '.system_generated',
        'logs',
        'transcript.jsonl',
      );
    return this.transcriptPath;
  }

  onUpdate(callback: () => void) {
    this.onUpdateCallback = callback;
    this.ensureWatcher();
  }

  private ensureWatcher() {
    if (this.watcher) return;
    const tPath = this.getTranscriptPath();
    if (existsSync(tPath)) {
      try {
        this.watcher = watch(tPath, () => {
          if (this.watchTimer) clearTimeout(this.watchTimer);
          this.watchTimer = setTimeout(() => {
            this.watchTimer = undefined;
            try {
              this.onUpdateCallback?.();
            } catch {}
          }, 50);
        });
      } catch {}
    }
  }

  async refresh(): Promise<LiveState> {
    this.ensureWatcher();
    const runner = await getAgentApiRunner(this.antigravityHome);
    const summaries = getAntigravitySummaries(this.antigravityHome);
    const summary = summaries.get(this.session.nativeId);
    let exec = getAntigravityExecution(summary, this.getTranscriptPath());

    if (Date.now() - this.justSentAt < 3000 && exec.state === 'IDLE') {
      exec = { state: 'RUNNING', reason: '智能体正在处理发送的消息' };
    }

    const isRunning = exec.state === 'RUNNING';
    const isTestEnv = !!process.env.AGENT_BOARD_ANTIGRAVITY_HOME;
    const creds = !isTestEnv && runner ? await resolveAntigravityCredentials(runner.exe) : null;
    const hasServer = isTestEnv || !!creds;
    const canSend = !!runner && hasServer && !isRunning;

    return {
      epoch: this.epoch,
      phase: isRunning ? 'RUNNING' : canSend ? 'READY' : 'OBSERVE_ONLY',
      reason: isRunning
        ? `Antigravity 智能体正在执行中（${exec.reason}）；执行完成后可继续发送`
        : !hasServer && !!runner
          ? `未检测到运行中的 Antigravity 语言服务（原客户端未启动或未就绪）；看板提供同屏实时观察`
          : canSend
            ? `已连接 Antigravity 原生会话（${exec.reason}）；在此输入可继续与智能体对话`
            : `已连接 Antigravity 原生记录（${exec.reason}）；看板提供同屏实时观察`,
      pending: [],
      canSend,
      canInterrupt: false,
    };
  }

  async send(text: string): Promise<void> {
    const runner = await getAgentApiRunner(this.antigravityHome);
    if (!runner) {
      throw new Error('未找到 Antigravity CLI 工具 (agentapi)，无法发送消息');
    }

    const isTestEnv = !!process.env.AGENT_BOARD_ANTIGRAVITY_HOME;
    const creds = !isTestEnv ? await resolveAntigravityCredentials(runner.exe) : null;
    if (!isTestEnv && !creds) {
      throw new Error('未检测到 Antigravity 运行中的语言服务，请确保 Antigravity 原客户端正在运行');
    }

    // 1. Resolve target projectId
    const summaries = getAntigravitySummaries(this.antigravityHome);
    const summary = summaries.get(this.session.nativeId);
    let targetProjectId = summary?.projectId;

    // Prepare execution environment
    const env: NodeJS.ProcessEnv = { ...process.env };
    // CRITICAL: Strip inherited caller metadata that restricts requests to a foreign project/session
    delete env.ANTIGRAVITY_SOURCE_METADATA;

    if (creds) {
      env.ANTIGRAVITY_LS_ADDRESS = creds.address;
      env.ANTIGRAVITY_CSRF_TOKEN = creds.csrfToken;
    }

    // 2. If targetProjectId is still unknown and not in test mode, query conversation metadata
    if (!targetProjectId && !isTestEnv) {
      try {
        const metaOut = await new Promise<string>((res, rej) => {
          execFile(
            runner.exe,
            [...runner.argsPrefix, 'get-conversation-metadata', this.session.nativeId],
            { env, shell: runner.shell, windowsHide: true, timeout: 5000 },
            (err, stdout) => {
              if (err) rej(err);
              else res(stdout);
            },
          );
        });
        const parsed = JSON.parse(metaOut);
        const fetchedPid = parsed?.response?.conversationMetadata?.metadata?.projectId;
        if (fetchedPid) {
          targetProjectId = fetchedPid;
        }
      } catch {}
    }

    if (targetProjectId) {
      env.ANTIGRAVITY_PROJECT_ID = targetProjectId;
    }
    env.ANTIGRAVITY_CONVERSATION_ID = this.session.nativeId;

    this.justSentAt = Date.now();
    const args = [...runner.argsPrefix, 'send-message', this.session.nativeId, text];
    await new Promise<void>((resolve, reject) => {
      execFile(
        runner.exe,
        args,
        { env, shell: runner.shell, windowsHide: true, timeout: 20000 },
        (error, stdout, stderr) => {
          this.justSentAt = Date.now();
          setTimeout(() => {
            try {
              this.onUpdateCallback?.();
            } catch {}
          }, 80);
          let parsedError: string | null = null;
          if (stdout) {
            try {
              const parsed = JSON.parse(stdout);
              if (parsed.error) {
                parsedError = parsed.error;
              }
            } catch {}
          }

          if (error || parsedError) {
            if (
              parsedError?.includes('Unavailable') ||
              parsedError?.includes('connection error') ||
              parsedError?.includes('EOF')
            ) {
              invalidateAntigravityCredentialsCache();
            }

            let message = parsedError || stderr || error?.message || '未知错误';
            if (message.includes('PermissionDenied') && message.includes('project_id')) {
              message = `Antigravity 项目权限限制：当前运行的原客户端工作区与目标会话所属项目不一致（${message}）。请在 Antigravity 客户端中切换到对应工作区后再试。`;
            }
            reject(new Error(`Antigravity 消息发送失败: ${message}`));
            return;
          }
          resolve();
        },
      );
    });
  }

  async decision(): Promise<void> {
    throw new Error('暂不支持在看板中进行交互决策');
  }

  async interrupt(): Promise<void> {
    throw new Error('请在 Antigravity 原客户端中停止当前执行');
  }

  async close(): Promise<void> {
    if (this.watchTimer) {
      clearTimeout(this.watchTimer);
      this.watchTimer = undefined;
    }
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {}
      this.watcher = undefined;
    }
  }
}
