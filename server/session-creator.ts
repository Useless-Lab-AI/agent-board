import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Discovery, NativeSession } from './discovery.js';
import type { InteractionAttachment } from '../shared/interaction.js';
import type { SessionTitles } from './session-titles.js';
import { hash } from './security.js';
import { getAgentApiRunner } from './antigravity-client.js';
import { resolveAntigravityCredentials } from './antigravity-ls.js';
import { formatPromptWithAttachments } from './interaction.js';

export interface CreateSessionOptions {
  provider: 'codex' | 'claude' | 'antigravity';
  cwd?: string;
  prompt: string;
  title?: string;
  model?: string;
  launchTerminal?: boolean;
  attachments?: InteractionAttachment[];
}

export interface SessionCreatorContext {
  antigravityHome: string;
  codexHome: string;
  claudeHome: string;
  discovery: Discovery;
  reconcile: () => Promise<void>;
  titles?: SessionTitles;
}

export interface CreateSessionResult {
  ok: boolean;
  id?: string;
  nativeId?: string;
  provider: 'codex' | 'claude' | 'antigravity';
  message?: string;
  error?: string;
}

function escapePowershellArg(str: string): string {
  return `'${str.replace(/'/g, "''")}'`;
}

let cachedWtExists: boolean | undefined = undefined;

async function isWindowsTerminalAvailable(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  if (cachedWtExists !== undefined) return cachedWtExists;
  return new Promise((resolve) => {
    execFile('where', ['wt.exe'], (err) => {
      cachedWtExists = !err;
      resolve(!err);
    });
  });
}

export async function createSession(
  options: CreateSessionOptions,
  context: SessionCreatorContext,
): Promise<CreateSessionResult> {
  const targetCwd =
    options.cwd && existsSync(options.cwd) ? path.resolve(options.cwd) : process.cwd();

  const prompt = formatPromptWithAttachments(options.prompt || '', options.attachments);
  const provider = options.provider;

  if (provider === 'antigravity') {
    const runner = await getAgentApiRunner(context.antigravityHome);
    if (!runner) {
      throw new Error('未找到 Antigravity CLI 工具 (agentapi)，无法创建新会话');
    }

    const isTestEnv = !!process.env.AGENT_BOARD_ANTIGRAVITY_HOME;
    const creds = !isTestEnv ? await resolveAntigravityCredentials(runner.exe) : null;
    if (!isTestEnv && !creds) {
      throw new Error(
        '未检测到 Antigravity 语言服务（language_server.exe），请确保 Antigravity 原客户端正在运行',
      );
    }

    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.ANTIGRAVITY_SOURCE_METADATA;

    if (creds) {
      env.ANTIGRAVITY_LS_ADDRESS = creds.address;
      env.ANTIGRAVITY_CSRF_TOKEN = creds.csrfToken;
    }

    const args = [...runner.argsPrefix, 'new-conversation'];
    const modelStr = (options.model || '').toLowerCase();
    let tier = 'flash';
    if (modelStr.includes('pro') || modelStr.includes('opus') || modelStr.includes('argon')) {
      tier = 'pro';
    } else if (modelStr.includes('lite') || modelStr.includes('haiku')) {
      tier = 'flash_lite';
    } else if (['flash', 'pro', 'flash_lite'].includes(options.model || '')) {
      tier = options.model!;
    }
    args.push(`--model=${tier}`);
    if (options.title && options.title.trim()) {
      args.push(`--title=${options.title.trim()}`);
    }
    args.push(prompt || '新会话已开启，请向智能体提问');

    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        runner.exe,
        args,
        {
          env,
          cwd: targetCwd,
          shell: runner.shell,
          windowsHide: true,
          timeout: 20000,
        },
        (err, out, stderr) => {
          if (err) return reject(new Error(stderr || err.message));
          resolve(out);
        },
      );
    });

    let conversationId = '';
    try {
      const parsed = JSON.parse(stdout);
      conversationId =
        parsed?.response?.newConversation?.conversationId ||
        parsed?.newConversation?.conversationId ||
        parsed?.conversationId ||
        '';
    } catch {
      const match = stdout.match(/"conversationId":\s*"([^"]+)"/);
      if (match) conversationId = match[1];
    }

    const id = conversationId ? hash('antigravity:' + conversationId) : undefined;
    if (id && conversationId) {
      const computedTitle =
        options.title?.trim() || options.prompt?.trim().split('\n')[0].slice(0, 240) || '新建会话';
      if (context.titles) {
        context.titles.values.set(id, { title: computedTitle });
      }

      const transcriptPath = path.join(
        context.antigravityHome,
        'brain',
        conversationId,
        '.system_generated',
        'logs',
        'transcript.jsonl',
      );

      // Brief wait to see if transcript.jsonl has been created by language_server
      const t0 = Date.now();
      let transcriptStat: { size: number; mtimeMs: number } | null = null;
      while (Date.now() - t0 < 600) {
        if (existsSync(transcriptPath)) {
          try {
            const st = statSync(transcriptPath);
            if (st.size > 0) {
              transcriptStat = st;
              break;
            }
          } catch {}
        }
        await new Promise((r) => setTimeout(r, 60));
      }

      const nativeSession: NativeSession = {
        id,
        nativeId: conversationId,
        provider: 'antigravity',
        cwd: targetCwd,
        files: transcriptStat
          ? [
              {
                path: transcriptPath,
                root: path.join(context.antigravityHome, 'brain'),
                key: hash(transcriptPath),
                generation: '1',
                size: transcriptStat.size,
                mtime: transcriptStat.mtimeMs,
                anchor: '',
                head: { sessionId: conversationId, cwd: targetCwd, title: computedTitle },
              },
            ]
          : existsSync(transcriptPath)
            ? [
                {
                  path: transcriptPath,
                  root: path.join(context.antigravityHome, 'brain'),
                  key: hash(transcriptPath),
                  generation: '1',
                  size: 0,
                  mtime: Date.now(),
                  anchor: '',
                  head: { sessionId: conversationId, cwd: targetCwd, title: computedTitle },
                },
              ]
            : [],
        diagnostics: [],
        createdAt: Date.now(),
      };
      context.discovery.sessions.set(id, nativeSession);
    }

    // Trigger non-blocking reconcile in background so the rest of the board catches up
    void context.reconcile();

    return {
      ok: true,
      id,
      nativeId: conversationId || undefined,
      provider: 'antigravity',
      message: 'Antigravity 新会话已创建',
    };
  }

  if (provider === 'codex') {
    const launchTerminal = options.launchTerminal === true;
    const modelParam = options.model && options.model.trim() ? options.model.trim() : undefined;

    if (launchTerminal) {
      const wtAvailable = await isWindowsTerminalAvailable();
      const psPromptArg = prompt ? ` ${escapePowershellArg(prompt)}` : '';
      const psModelArg = modelParam ? ` -m ${escapePowershellArg(modelParam)}` : '';

      if (process.platform === 'win32') {
        if (wtAvailable) {
          const wtArgs = [
            '-w',
            '0',
            'nt',
            '-d',
            targetCwd,
            'powershell',
            '-NoExit',
            '-Command',
            `codex${psModelArg}${psPromptArg}`,
          ];
          const child = spawn('wt.exe', wtArgs, { detached: true, stdio: 'ignore' });
          child.unref();
        } else {
          const psCommand = `Set-Location ${escapePowershellArg(targetCwd)}; codex${psModelArg}${psPromptArg}`;
          const child = spawn(
            'cmd.exe',
            ['/c', 'start', 'powershell', '-NoExit', '-Command', psCommand],
            {
              detached: true,
              stdio: 'ignore',
            },
          );
          child.unref();
        }
      } else {
        const args: string[] = [];
        if (modelParam) args.push('-m', modelParam);
        if (prompt) args.push(prompt);
        const child = spawn('codex', args, {
          cwd: targetCwd,
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
      }
    } else {
      const args = ['exec'];
      if (modelParam) args.push('-m', modelParam);
      args.push('-C', targetCwd, prompt || 'Hello');
      const child = spawn('codex', args, {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    }

    await new Promise((r) => setTimeout(r, 600));
    void context.reconcile();

    const matching = [...context.discovery.sessions.values()]
      .filter((s) => s.provider === 'codex')
      .sort(
        (a, b) =>
          Math.max(0, ...b.files.map((f) => f.mtime)) - Math.max(0, ...a.files.map((f) => f.mtime)),
      );

    const newest = matching[0];
    return {
      ok: true,
      id: newest?.id,
      nativeId: newest?.nativeId,
      provider: 'codex',
      message: 'Codex 会话已启动',
    };
  }

  if (provider === 'claude') {
    const launchTerminal = options.launchTerminal === true;
    const modelParam = options.model && options.model.trim() ? options.model.trim() : undefined;
    const customTitle = options.title && options.title.trim() ? options.title.trim() : undefined;
    const sessionId = randomUUID();
    const id = hash('claude:' + sessionId);
    const computedTitle =
      customTitle || options.prompt?.trim().split('\n')[0].slice(0, 240) || '新建会话';

    const bridgeExe = path.join(context.claudeHome, 'agent-board-bridge.exe');
    const hasBridge = existsSync(bridgeExe);

    if (launchTerminal) {
      const wtAvailable = await isWindowsTerminalAvailable();
      const claudeBase = hasBridge ? `& ${escapePowershellArg(bridgeExe)}` : 'claude';
      const psSessionArg = ` --session-id ${escapePowershellArg(sessionId)}`;
      const psNameArg = customTitle ? ` --name ${escapePowershellArg(customTitle)}` : '';
      const psPromptArg = prompt ? ` ${escapePowershellArg(prompt)}` : '';
      const psModelArg = modelParam ? ` --model ${escapePowershellArg(modelParam)}` : '';
      const fullCmd = `${claudeBase}${psSessionArg}${psNameArg}${psModelArg}${psPromptArg}`;

      if (process.platform === 'win32') {
        if (wtAvailable) {
          const wtArgs = [
            '-w',
            '0',
            'nt',
            '-d',
            targetCwd,
            'powershell',
            '-NoExit',
            '-Command',
            fullCmd,
          ];
          const child = spawn('wt.exe', wtArgs, { detached: true, stdio: 'ignore' });
          child.unref();
        } else {
          const psCommand = `Set-Location ${escapePowershellArg(targetCwd)}; ${fullCmd}`;
          const child = spawn(
            'cmd.exe',
            ['/c', 'start', 'powershell', '-NoExit', '-Command', psCommand],
            {
              detached: true,
              stdio: 'ignore',
            },
          );
          child.unref();
        }
      } else {
        const args: string[] = ['--session-id', sessionId];
        if (customTitle) args.push('--name', customTitle);
        if (modelParam) args.push('--model', modelParam);
        if (prompt) args.push(prompt);
        const child = spawn('claude', args, {
          cwd: targetCwd,
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
      }
    } else {
      const exe = hasBridge ? bridgeExe : 'claude';
      const args = [
        '--session-id',
        sessionId,
        '--dangerously-skip-permissions',
        '--settings',
        '{"hooks":{}}',
      ];
      if (customTitle) args.push('--name', customTitle);
      if (modelParam) args.push('--model', modelParam);
      args.push('-p', prompt || 'Hello');
      const child = spawn(exe, args, {
        cwd: targetCwd,
        shell: !hasBridge && process.platform === 'win32',
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    }

    if (context.titles) {
      context.titles.values.set(id, { title: computedTitle });
    }

    const encodedFolder = targetCwd.replace(/[^a-zA-Z0-9]/g, '-');
    const projectsRoot = path.join(context.claudeHome, 'projects');
    const transcriptPath = path.join(projectsRoot, encodedFolder, `${sessionId}.jsonl`);

    const t0 = Date.now();
    let transcriptStat: { size: number; mtimeMs: number } | null = null;
    while (Date.now() - t0 < 500) {
      if (existsSync(transcriptPath)) {
        try {
          const st = statSync(transcriptPath);
          if (st.size > 0) {
            transcriptStat = st;
            break;
          }
        } catch {}
      }
      await new Promise((r) => setTimeout(r, 60));
    }

    const nativeSession: NativeSession = {
      id,
      nativeId: sessionId,
      provider: 'claude',
      cwd: targetCwd,
      files: transcriptStat
        ? [
            {
              path: transcriptPath,
              root: projectsRoot,
              key: hash(transcriptPath),
              generation: '1',
              size: transcriptStat.size,
              mtime: transcriptStat.mtimeMs,
              anchor: '',
              head: { sessionId, cwd: targetCwd, title: computedTitle },
            },
          ]
        : [],
      diagnostics: [],
      createdAt: Date.now(),
    };
    context.discovery.sessions.set(id, nativeSession);

    void context.reconcile();

    return {
      ok: true,
      id,
      nativeId: sessionId,
      provider: 'claude',
      message: 'Claude 会话已启动',
    };
  }

  throw new Error(`不支持的 Provider: ${provider}`);
}
