import { readdir, readFile, unlink } from 'node:fs/promises';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import type { NativeSession } from './discovery.js';
import type { InteractionQuestion, InteractionRequest } from '../shared/interaction.js';
import type { LiveClient, LiveState } from './live-client.js';

const execFileAsync = promisify(execFile);

export interface BridgePendingItem {
  id: string;
  kind: 'approval' | 'question';
  title: string;
  detail: string;
  questions?: InteractionQuestion[];
  toolName?: string;
  toolUseId?: string;
}

interface BridgeEndpoint {
  pid: number;
  bridgePid: number;
  sessionId: string;
  port: number;
  token: string;
  createdAt: number;
  capabilities?: string[];
  pending?: BridgePendingItem[];
}

interface ChannelEndpoint {
  pid: number;
  parentPid: number;
  sessionId: string;
  port: number;
  token: string;
  epoch: string;
}

interface SessionProcessInfo {
  pid: number;
  status: string;
  cwd: string;
}

function normalizePendingItems(raw: unknown): InteractionRequest[] {
  if (!Array.isArray(raw)) return [];
  const res: InteractionRequest[] = [];
  for (const item of raw.slice(0, 16)) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, any>;
    if (typeof r.id !== 'string' || !r.id) continue;
    const kind = r.kind === 'question' ? 'question' : 'approval';
    const title = typeof r.title === 'string' && r.title ? r.title : kind === 'question' ? 'AI 需要你的回答' : '允许执行命令？';
    const detail = typeof r.detail === 'string' ? r.detail : '';
    if (detail.length > 16000) continue;
    if (kind === 'question') {
      const questions: InteractionQuestion[] = Array.isArray(r.questions)
        ? r.questions
            .filter((q: any) => q && typeof q.id === 'string' && typeof q.text === 'string')
            .map((q: any) => ({
              id: q.id,
              text: q.text,
              options: Array.isArray(q.options) ? q.options.filter((o: any) => typeof o === 'string') : [],
              ...(q.multiple ? { multiple: true } : {}),
            }))
        : [];
      if (questions.length === 0) continue;
      res.push({ id: r.id, kind: 'question', title, detail, questions });
    } else {
      res.push({ id: r.id, kind: 'approval', title, detail });
    }
  }
  return res;
}

export class ClaudeClient implements LiveClient {
  private bridgeEndpoint?: BridgeEndpoint;
  private lastBridgePid?: number;
  private channelEndpoint?: ChannelEndpoint;
  private pendingSources = new Map<string, 'bridge' | 'channel'>();
  private sessionProc?: SessionProcessInfo;
  private lastSessionPid?: number;
  private localEpoch = randomUUID();
  private runningProc?: ChildProcess;
  private runningOutput = '';
  private lastError = '';
  private updateCallbacks = new Set<() => void>();
  private watchers: FSWatcher[] = [];
  private watchTimer?: NodeJS.Timeout;

  constructor(private session: NativeSession, private home: string) {
    this.ensureWatchers();
  }

  private ensureWatchers() {
    if (this.watchers.length > 0) return;
    for (const sub of ['agent-board-bridges', 'sessions', 'agent-board-channels']) {
      const dir = path.join(this.home, sub);
      if (existsSync(dir)) {
        try {
          const w = watch(dir, () => {
            if (this.watchTimer) clearTimeout(this.watchTimer);
            this.watchTimer = setTimeout(() => {
              this.watchTimer = undefined;
              this.notifyUpdate();
            }, 60);
          });
          w.on('error', () => {});
          this.watchers.push(w);
        } catch {}
      }
    }
  }

  onUpdate(cb: () => void) {
    this.updateCallbacks.add(cb);
    this.ensureWatchers();
  }

  private notifyUpdate() {
    for (const cb of this.updateCallbacks) {
      try {
        cb();
      } catch {}
    }
  }

  private async discoverBridge(): Promise<BridgeEndpoint | undefined> {
    const bridgesDir = path.join(this.home, 'agent-board-bridges');
    const names = await readdir(bridgesDir).catch(() => []);
    for (const name of names.filter(n => /^\d+\.json$/.test(n)).slice(0, 128)) {
      const file = path.join(bridgesDir, name);
      try {
        const raw = await readFile(file, 'utf8');
        const data = JSON.parse(raw) as BridgeEndpoint;
        try {
          process.kill(data.pid, 0);
          process.kill(data.bridgePid, 0);
        } catch {
          await unlink(file).catch(() => {});
          continue;
        }

        if (data.sessionId && data.sessionId === this.session.nativeId) {
          return data;
        }

        const sessionFile = path.join(this.home, 'sessions', `${data.pid}.json`);
        if (existsSync(sessionFile)) {
          const sData = JSON.parse(await readFile(sessionFile, 'utf8'));
          if (sData.sessionId === this.session.nativeId) {
            return { ...data, sessionId: sData.sessionId };
          }
        }
      } catch {}
    }
    return undefined;
  }

  private async discoverChannel(): Promise<ChannelEndpoint | undefined> {
    const channelsDir = path.join(this.home, 'agent-board-channels');
    const names = await readdir(channelsDir).catch(() => []);
    for (const name of names.filter(n => /^\d+\.json$/.test(n)).slice(0, 128)) {
      const file = path.join(channelsDir, name);
      try {
        const raw = await readFile(file, 'utf8');
        const data = JSON.parse(raw) as ChannelEndpoint;
        if (data.sessionId !== this.session.nativeId) continue;
        try {
          process.kill(data.pid, 0);
          if (data.parentPid) process.kill(data.parentPid, 0);
        } catch {
          await unlink(file).catch(() => {});
          continue;
        }
        return data;
      } catch {}
    }
    return undefined;
  }

  private async queryBridgeState(bridge: BridgeEndpoint): Promise<InteractionRequest[] | undefined> {
    if (!bridge.capabilities?.includes('approval_v1')) {
      return undefined;
    }
    return new Promise<InteractionRequest[] | undefined>((resolve) => {
      let settled = false;
      const finish = (val?: InteractionRequest[]) => {
        if (!settled) {
          settled = true;
          socket.destroy();
          resolve(val);
        }
      };
      const socket = net.createConnection({ port: bridge.port, host: '127.0.0.1' }, () => {
        try {
          socket.write(JSON.stringify({ type: 'auth', token: bridge.token }) + '\n');
        } catch {
          finish(undefined);
        }
      });

      let buffer = '';
      socket.on('data', (d) => {
        buffer += d.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const res = JSON.parse(trimmed);
            if (res.status === 'authenticated') {
              socket.write(JSON.stringify({ type: 'get_state' }) + '\n');
            } else if (res.status === 'ok' && Array.isArray(res.pending)) {
              finish(normalizePendingItems(res.pending));
            } else if (res.error) {
              finish(undefined);
            }
          } catch {}
        }
      });

      socket.on('error', () => finish(undefined));
      setTimeout(() => finish(undefined), 1200);
    });
  }

  private async queryChannelPending(channel: ChannelEndpoint): Promise<InteractionRequest[]> {
    try {
      const res = await fetch(`http://127.0.0.1:${channel.port}/state`, {
        headers: { Authorization: `Bearer ${channel.token}` },
        signal: AbortSignal.timeout(1200),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { epoch?: string; pending?: unknown };
      if (data.epoch) channel.epoch = data.epoch;
      return normalizePendingItems(data.pending);
    } catch {
      return [];
    }
  }

  private async sendViaBridge(bridge: BridgeEndpoint, text: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = net.createConnection({ port: bridge.port, host: '127.0.0.1' }, () => {
        try {
          socket.write(JSON.stringify({ type: 'auth', token: bridge.token }) + '\n');
        } catch (err) {
          if (!settled) {
            settled = true;
            socket.destroy();
            reject(err);
          }
        }
      });

      let buffer = '';

      socket.on('data', (d) => {
        buffer += d.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const res = JSON.parse(trimmed);
            if (res.status === 'authenticated') {
              socket.write(JSON.stringify({ text }) + '\n');
            } else if (res.status === 'ok') {
              if (!settled) {
                settled = true;
                setTimeout(() => {
                  socket.end();
                  resolve();
                }, 50);
              }
            } else if (res.error) {
              if (!settled) {
                settled = true;
                socket.destroy();
                reject(new Error(res.error));
              }
            }
          } catch {}
        }
      });

      socket.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.destroy();
          reject(new Error('向 Claude 桥接标准输入发送消息超时'));
        }
      }, 5000);
    });
  }

  private async decisionViaBridge(
    bridge: BridgeEndpoint,
    requestId: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    if (!bridge.capabilities?.includes('approval_v1')) {
      throw new Error('当前 Claude 会话使用的是旧版桥接进程，请在 VS Code 中重开一次此会话或直接在原客户端确认');
    }
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = net.createConnection({ port: bridge.port, host: '127.0.0.1' }, () => {
        try {
          socket.write(JSON.stringify({ type: 'auth', token: bridge.token }) + '\n');
        } catch (err) {
          if (!settled) {
            settled = true;
            socket.destroy();
            reject(err);
          }
        }
      });

      let buffer = '';

      socket.on('data', (d) => {
        buffer += d.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const res = JSON.parse(trimmed);
            if (res.status === 'authenticated') {
              socket.write(
                JSON.stringify({
                  type: 'decision',
                  requestId,
                  decision: typeof body.decision === 'string' ? body.decision : undefined,
                  answers:
                    body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)
                      ? body.answers
                      : undefined,
                }) + '\n',
              );
            } else if (res.status === 'ok') {
              if (!settled) {
                settled = true;
                setTimeout(() => {
                  socket.end();
                  resolve();
                }, 30);
              }
            } else if (res.error) {
              if (!settled) {
                settled = true;
                socket.destroy();
                reject(new Error(res.error));
              }
            }
          } catch {}
        }
      });

      socket.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.destroy();
          reject(new Error('向 Claude 桥接发送审批决定超时'));
        }
      }, 5000);
    });
  }

  private async decisionViaChannel(
    channel: ChannelEndpoint,
    requestId: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    const res = await fetch(`http://127.0.0.1:${channel.port}/decision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${channel.token}`,
        Origin: `http://127.0.0.1:${channel.port}`,
      },
      body: JSON.stringify({
        epoch: channel.epoch,
        sessionId: channel.sessionId,
        id: requestId,
        decision: body.decision,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error || `Channel 审批响应失败 (${res.status})`);
    }
  }

  private async discoverSessionProcess(): Promise<SessionProcessInfo | undefined> {
    const sessionsDir = path.join(this.home, 'sessions');
    const names = await readdir(sessionsDir).catch(() => []);
    for (const name of names.filter(n => /^\d+\.json$/.test(n)).slice(0, 128)) {
      try {
        const file = path.join(sessionsDir, name);
        const raw = await readFile(file, 'utf8');
        const data = JSON.parse(raw);
        if (data.sessionId !== this.session.nativeId || typeof data.pid !== 'number') {
          continue;
        }
        try {
          process.kill(data.pid, 0);
        } catch {
          continue;
        }
        return {
          pid: data.pid,
          status: data.status || 'idle',
          cwd: typeof data.cwd === 'string' ? data.cwd : '',
        };
      } catch {}
    }
    return undefined;
  }

  private async stopLegacyUnbridgedProcess(pid: number): Promise<string[]> {
    const extraDirs: string[] = [];
    if (process.platform === 'win32') {
      try {
        const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$proc = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"
if ($proc -and $proc.Name -eq 'claude.exe') {
  $cmd = $proc.CommandLine
  $ppid = $proc.ParentProcessId
  $parent = if ($ppid) { Get-CimInstance Win32_Process -Filter "ProcessId = $ppid" } else { $null }
  $code = @'
using System;
using System.Runtime.InteropServices;
public class CleanExit {
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool TerminateProcess(IntPtr h, uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool CloseHandle(IntPtr h);
  public static void StopZero(int pid) {
    IntPtr h = OpenProcess(1, false, pid);
    if (h != IntPtr.Zero) { TerminateProcess(h, 0); CloseHandle(h); }
  }
}
'@
  Add-Type -TypeDefinition $code
  if ($parent -and ($parent.Name -like 'agent-board-*.exe')) {
    [CleanExit]::StopZero([int]$ppid)
  }
  [CleanExit]::StopZero(${pid})
  Write-Output $cmd
}
`;
        const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', psScript], { timeout: 4000 });
        const cmdLine = stdout.trim();
        const regex = /--add-dir(?:=|\s+)(?:"([^"]+)"|([^\s"]+))/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(cmdLine)) !== null) {
          const dir = (match[1] || match[2] || '').trim();
          if (dir && existsSync(dir)) {
            extraDirs.push(path.resolve(dir));
          }
        }
      } catch {}
    } else {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {}
    }
    await unlink(path.join(this.home, 'sessions', `${pid}.json`)).catch(() => {});
    return extraDirs;
  }

  private async resolveWorkspaceAddDirs(cwd: string, initialDirs: string[] = []): Promise<string[]> {
    const dirSet = new Set<string>(initialDirs.map(d => path.resolve(d)));
    const resolvedCwd = path.resolve(cwd);
    try {
      const entries = await readdir(cwd);
      for (const entry of entries.filter(e => e.endsWith('.code-workspace'))) {
        try {
          const raw = await readFile(path.join(cwd, entry), 'utf8');
          const ws = JSON.parse(raw);
          if (Array.isArray(ws?.folders)) {
            for (const folder of ws.folders) {
              if (typeof folder?.path === 'string' && folder.path.trim()) {
                const candidate = path.resolve(cwd, folder.path.trim());
                if (candidate !== resolvedCwd && existsSync(candidate)) {
                  dirSet.add(candidate);
                }
              }
            }
          }
        } catch {}
      }
    } catch {}
    return [...dirSet];
  }

  async refresh(): Promise<LiveState> {
    this.ensureWatchers();
    try {
      this.bridgeEndpoint = await this.discoverBridge();
      if (this.bridgeEndpoint && this.bridgeEndpoint.pid !== this.lastBridgePid) {
        this.lastBridgePid = this.bridgeEndpoint.pid;
        this.localEpoch = randomUUID();
      }
    } catch {
      this.bridgeEndpoint = undefined;
    }

    try {
      this.sessionProc = await this.discoverSessionProcess();
      if (this.sessionProc && this.sessionProc.pid !== this.lastSessionPid) {
        this.lastSessionPid = this.sessionProc.pid;
        this.localEpoch = randomUUID();
      }
    } catch {
      this.sessionProc = undefined;
    }

    try {
      this.channelEndpoint = await this.discoverChannel();
    } catch {
      this.channelEndpoint = undefined;
    }

    this.pendingSources.clear();
    let pending: InteractionRequest[] = [];

    if (this.bridgeEndpoint) {
      const liveBridgePending = await this.queryBridgeState(this.bridgeEndpoint);
      const bridgePending = liveBridgePending ?? normalizePendingItems(this.bridgeEndpoint.pending);
      for (const p of bridgePending) {
        this.pendingSources.set(p.id, 'bridge');
        pending.push(p);
      }
    }

    if (pending.length === 0 && this.channelEndpoint) {
      const channelPending = await this.queryChannelPending(this.channelEndpoint);
      for (const p of channelPending) {
        this.pendingSources.set(p.id, 'channel');
        pending.push(p);
      }
    }

    // 1. 优先使用透明标准输入桥接（直通 Claude stdin，具备完全用户权限，在 VS Code 正常呈现消息气泡，且不带 peer 警告）
    if (this.bridgeEndpoint) {
      if (pending.length > 0) {
        const hasApproval = pending.some(p => p.kind === 'approval');
        return {
          epoch: this.localEpoch,
          phase: hasApproval ? 'WAITING_APPROVAL' : 'WAITING_INPUT',
          reason: hasApproval
            ? 'Claude 正在等待工具审批确认；可在此直接允许/拒绝，或在原客户端处理。'
            : 'Claude 正在等待你回答问题；可在此直接提交回答，或在原客户端处理。',
          pending,
          canSend: false,
          canInterrupt: false,
          output: this.runningOutput,
          truncated: false,
        };
      }

      const isBusy = this.sessionProc?.status === 'busy';
      return {
        epoch: this.localEpoch,
        phase: isBusy ? 'RUNNING' : 'READY',
        reason: isBusy
          ? 'Claude 正在响应并执行中；可在 VS Code 或在此继续交互。'
          : '已连接 Claude 原生会话（透明标准输入桥接在线，具备完全用户权限）；在此输入可直接与 Claude 继续对话。',
        pending: [],
        canSend: true,
        canInterrupt: false,
        output: this.runningOutput,
        truncated: false,
      };
    }

    // 2. 如果后台正在执行该会话的续接任务
    if (this.runningProc) {
      return {
        epoch: this.localEpoch,
        phase: 'RUNNING',
        reason: 'Claude 正在响应并执行中；执行完成后可继续发送。',
        pending: [],
        canSend: false,
        canInterrupt: true,
        output: this.runningOutput,
        truncated: false,
      };
    }

    // 3. 如果存在早期未挂载桥接的旧会话进程
    if (this.sessionProc) {
      if (pending.length > 0) {
        const hasApproval = pending.some(p => p.kind === 'approval');
        return {
          epoch: this.localEpoch,
          phase: hasApproval ? 'WAITING_APPROVAL' : 'WAITING_INPUT',
          reason: hasApproval
            ? 'Claude 正在等待工具审批确认；可在此直接允许/拒绝，或在原客户端处理。'
            : 'Claude 正在等待你回答问题；可在此直接提交回答，或在原客户端处理。',
          pending,
          canSend: false,
          canInterrupt: false,
          output: this.runningOutput,
          truncated: false,
        };
      }
      const isBusy = this.sessionProc.status === 'busy';
      return {
        epoch: this.localEpoch,
        phase: isBusy ? 'RUNNING' : 'READY',
        reason: isBusy
          ? 'Claude 正在原客户端执行任务；请等待当前回复完成后继续交互。'
          : '已连接 Claude 原生会话；在此输入将以真实用户身份直接续接（不会触发跨会话提示）。',
        pending: [],
        canSend: !isBusy,
        canInterrupt: false,
        output: this.runningOutput,
        truncated: false,
      };
    }

    // 4. AI 响应已完成，处于就绪等待输入状态
    return {
      epoch: this.localEpoch,
      phase: 'READY',
      reason: this.lastError
        ? `执行提示: ${this.lastError}。在此输入即可继续此会话。`
        : 'AI 响应已完成；在此输入即可直接续接此会话。',
      pending: [],
      canSend: true,
      canInterrupt: false,
      output: this.runningOutput,
      truncated: false,
    };
  }

  async send(text: string, _requestId: string): Promise<void> {
    // 实时重查最新的透明标准输入桥接状态
    this.bridgeEndpoint = await this.discoverBridge().catch(() => undefined);

    // 1. 优先使用透明标准输入桥接（直通 Claude stdin，具备完全用户权限，在 VS Code 正常呈现消息气泡，且绝不触发 Another Claude session sent...）
    if (this.bridgeEndpoint) {
      await this.sendViaBridge(this.bridgeEndpoint, text);
      return;
    }

    // 2. 进程正在执行时，防止重复并发提交
    if (this.runningProc) {
      throw new Error('Claude 正在执行中，请等待回复完成后再发送');
    }

    // 3. 检查是否存在未接入桥接的旧版遗留进程（绝不使用 cc-msg 命名管道，因为 cc-msg 会被 Claude 硬编码标记为 origin: peer 并触发 "Another Claude session sent..."）
    this.sessionProc = await this.discoverSessionProcess().catch(() => undefined);
    let legacyAddDirs: string[] = [];
    if (this.sessionProc) {
      if (this.sessionProc.status === 'busy') {
        throw new Error('Claude 正在原客户端执行中，请等待当前回复完成后再发送');
      }
      // 平滑接管空闲的旧版遗留进程（以退出码 0 静默关闭旧管道，后续 VS Code 发消息会自动拉起新版 bridge）
      legacyAddDirs = await this.stopLegacyUnbridgedProcess(this.sessionProc.pid);
      this.sessionProc = undefined;
    }

    const bridgeExe = path.join(this.home, 'agent-board-bridge.exe');
    const wrapperExe = path.join(this.home, 'agent-board-wrapper.exe');
    const exe = existsSync(bridgeExe) ? bridgeExe : existsSync(wrapperExe) ? wrapperExe : 'claude.cmd';
    const cwd =
      (this.session.cwd && existsSync(this.session.cwd) ? this.session.cwd : undefined) ||
      process.cwd();

    const addDirs = await this.resolveWorkspaceAddDirs(cwd, legacyAddDirs);
    const addDirArgs = addDirs.map(dir => `--add-dir=${dir}`);

    const args = [
      '--resume',
      this.session.nativeId,
      '--dangerously-skip-permissions',
      '--settings',
      '{"hooks":{}}',
      '--output-format',
      'stream-json',
      '--verbose',
      ...addDirArgs,
      '-p',
      text,
    ];

    this.runningOutput = '';
    this.lastError = '';

    const proc = spawn(exe, args, {
      cwd,
      shell: exe === 'claude.cmd',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
      },
    });

    this.runningProc = proc;
    this.notifyUpdate();

    let stdoutBuf = '';
    let resultReceived = false;

    const killProcTree = (pid?: number) => {
      if (!pid) return;
      if (process.platform === 'win32') {
        execFile('taskkill', ['/F', '/T', '/PID', String(pid)], () => {});
      } else {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {}
      }
    };

    proc.stdout?.on('data', (d) => {
      stdoutBuf += d.toString('utf8');
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.type === 'result') {
            resultReceived = true;
            if (msg.is_error && typeof msg.result === 'string' && msg.result) {
              this.lastError = msg.result;
            }
            if (this.runningProc === proc) {
              this.runningProc = undefined;
              this.notifyUpdate();
            }
            const pid = proc.pid;
            setTimeout(() => killProcTree(pid), 150);
          }
        } catch {}
      }
      this.notifyUpdate();
    });

    proc.stderr?.on('data', () => {
      // Ignore config/permission lint warnings on stderr so Channel reply is not polluted
    });

    proc.on('close', (code) => {
      if (this.runningProc === proc) {
        this.runningProc = undefined;
      }
      if (!resultReceived && code !== 0 && code !== null && !this.lastError) {
        this.lastError = `进程退出码 ${code}`;
      }
      this.notifyUpdate();
    });

    proc.on('error', (err) => {
      if (this.runningProc === proc) {
        this.runningProc = undefined;
      }
      this.lastError = err.message;
      this.notifyUpdate();
    });
  }

  async decision(id: string, body: Record<string, unknown>) {
    const source = this.pendingSources.get(id);
    if (source === 'channel') {
      const channel = this.channelEndpoint ?? (await this.discoverChannel().catch(() => undefined));
      if (!channel) {
        throw new Error('Claude 审批通道已断开，请在原客户端处理');
      }
      await this.decisionViaChannel(channel, id, body);
      this.notifyUpdate();
      return;
    }

    this.bridgeEndpoint = await this.discoverBridge().catch(() => undefined);
    if (this.bridgeEndpoint && this.bridgeEndpoint.capabilities?.includes('approval_v1')) {
      await this.decisionViaBridge(this.bridgeEndpoint, id, body);
      this.notifyUpdate();
      return;
    }

    const channel = this.channelEndpoint ?? (await this.discoverChannel().catch(() => undefined));
    if (channel) {
      await this.decisionViaChannel(channel, id, body);
      this.notifyUpdate();
      return;
    }

    throw new Error('未找到支持审批的 Claude 透明桥接连接，请在原客户端处理');
  }

  async interrupt(): Promise<void> {
    if (this.runningProc) {
      const pid = this.runningProc.pid;
      this.runningProc.kill();
      if (pid && process.platform === 'win32') {
        execFile('taskkill', ['/F', '/T', '/PID', String(pid)], () => {});
      }
      this.runningProc = undefined;
      this.notifyUpdate();
      return;
    }
    throw new Error('原客户端运行中的任务请在原客户端（如 VS Code）点击取消或按 Ctrl+C');
  }

  async close() {
    if (this.watchTimer) {
      clearTimeout(this.watchTimer);
      this.watchTimer = undefined;
    }
    for (const w of this.watchers) {
      try {
        w.close();
      } catch {}
    }
    this.watchers = [];
    this.bridgeEndpoint = undefined;
    this.channelEndpoint = undefined;
    this.sessionProc = undefined;
    this.updateCallbacks.clear();
  }
}



