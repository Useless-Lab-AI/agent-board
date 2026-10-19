import { execFile } from 'node:child_process';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { NativeSession } from './discovery.js';
import type { InteractionRequest } from '../shared/interaction.js';
import type { LiveClient, LiveState } from './live-client.js';
import {
  getAntigravitySummaries,
  getAntigravityExecution,
  getAntigravityPendingAskQuestion,
} from './antigravity-meta.js';
import {
  resolveAntigravityCredentials,
  invalidateAntigravityCredentialsCache,
  sendAntigravityUserMessage,
  getAntigravityPendingAskQuestionStep,
  submitAntigravityAskQuestion,
  type AntigravityActiveAskQuestionStep,
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
  private activeAskQuestion?: AntigravityActiveAskQuestionStep;

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
    const tPath = this.getTranscriptPath();
    let exec = getAntigravityExecution(summary, tPath);

    if (Date.now() - this.justSentAt < 3000 && (exec.state === 'IDLE' || exec.state === 'WAITING_INPUT')) {
      exec = { state: 'RUNNING', reason: '智能体正在处理发送的消息' };
    }

    const isTestEnv = !!process.env.AGENT_BOARD_ANTIGRAVITY_HOME;
    const creds = !isTestEnv ? await resolveAntigravityCredentials(runner?.exe) : null;
    const hasServer = isTestEnv ? !!runner : !!creds;

    if (exec.state === 'WAITING_INPUT') {
      const pendingFromTranscript = getAntigravityPendingAskQuestion(tPath);
      if (creds) {
        const lsCheck = await getAntigravityPendingAskQuestionStep(
          creds,
          this.session.nativeId,
          pendingFromTranscript?.transcriptStepIndex ?? 0,
        );
        if (lsCheck.status === 'waiting') {
          this.activeAskQuestion = lsCheck.step;
        } else if (lsCheck.status === 'completed') {
          this.activeAskQuestion = undefined;
          exec = { state: 'IDLE', reason: 'Antigravity 会话就绪 / 空闲' };
        } else if (pendingFromTranscript) {
          this.activeAskQuestion = {
            trajectoryId: '',
            stepIndex: pendingFromTranscript.transcriptStepIndex + 1,
            title: pendingFromTranscript.title,
            rawQuestions: pendingFromTranscript.rawQuestions,
          };
        } else {
          this.activeAskQuestion = undefined;
        }
      } else if (pendingFromTranscript) {
        this.activeAskQuestion = {
          trajectoryId: 'test-trajectory',
          stepIndex: pendingFromTranscript.transcriptStepIndex + 1,
          title: pendingFromTranscript.title,
          rawQuestions: pendingFromTranscript.rawQuestions,
        };
      } else {
        this.activeAskQuestion = undefined;
      }
    } else {
      this.activeAskQuestion = undefined;
    }

    if (exec.state === 'WAITING_INPUT' && this.activeAskQuestion && hasServer) {
      const reqId = `ask_question_${this.activeAskQuestion.stepIndex}`;
      const pending: InteractionRequest[] = [
        {
          id: reqId,
          kind: 'question',
          title: this.activeAskQuestion.title || 'AI 需要你的回答',
          detail: '',
          questions: this.activeAskQuestion.rawQuestions.map((q, idx) => ({
            id: q.question || `q_${idx + 1}`,
            text: q.question,
            options: q.options.map((o) => o.text),
            ...(q.isMultiSelect ? { multiple: true } : {}),
          })),
        },
      ];
      return {
        epoch: this.epoch,
        phase: 'WAITING_INPUT',
        reason: 'Antigravity 智能体正在等待你回答问题；可直接在此选择选项并提交，或在原客户端处理',
        pending,
        canSend: false,
        canInterrupt: false,
      };
    }

    const isRunning = exec.state === 'RUNNING';
    const isWaiting = exec.state === 'WAITING_INPUT';
    const canSend = hasServer && !isRunning && !isWaiting;

    return {
      epoch: this.epoch,
      phase: isRunning ? 'RUNNING' : isWaiting ? 'WAITING_INPUT' : canSend ? 'READY' : 'OBSERVE_ONLY',
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
    const isTestEnv = !!process.env.AGENT_BOARD_ANTIGRAVITY_HOME;

    // In real Antigravity environment, send via LanguageServerService/SendUserCascadeMessage
    // so the message is recorded as USER_INPUT (user chat bubble) instead of SYSTEM_MESSAGE ("Message from System").
    if (!isTestEnv) {
      let creds = await resolveAntigravityCredentials(runner?.exe);
      if (!creds) {
        throw new Error('未检测到 Antigravity 运行中的语言服务，请确保 Antigravity 原客户端正在运行');
      }

      this.justSentAt = Date.now();
      let rpcRes = await sendAntigravityUserMessage(creds, this.session.nativeId, text);

      if (
        !rpcRes.ok &&
        (rpcRes.error?.includes('ECONNREFUSED') ||
          rpcRes.error?.includes('socket hang up') ||
          rpcRes.error?.includes('connection error') ||
          rpcRes.error?.includes('Unavailable') ||
          rpcRes.statusCode === 401 ||
          rpcRes.statusCode === 403)
      ) {
        invalidateAntigravityCredentialsCache();
        const freshCreds = await resolveAntigravityCredentials(runner?.exe);
        if (freshCreds) {
          creds = freshCreds;
          rpcRes = await sendAntigravityUserMessage(creds, this.session.nativeId, text);
        }
      }

      this.justSentAt = Date.now();
      setTimeout(() => {
        try {
          this.onUpdateCallback?.();
        } catch {}
      }, 80);

      if (rpcRes.ok) {
        return;
      }

      throw new Error(`Antigravity 消息发送失败: ${rpcRes.error || '未知错误'}`);
    }

    if (!runner) {
      throw new Error('未找到 Antigravity CLI 工具 (agentapi)，无法发送消息');
    }

    // 1. Resolve target projectId (for isolated test environments using mock agentapi)
    const summaries = getAntigravitySummaries(this.antigravityHome);
    const summary = summaries.get(this.session.nativeId);
    const targetProjectId = summary?.projectId;

    // Prepare execution environment
    const env: NodeJS.ProcessEnv = { ...process.env };
    // CRITICAL: Strip inherited caller metadata that restricts requests to a foreign project/session
    delete env.ANTIGRAVITY_SOURCE_METADATA;
    delete env.ANTIGRAVITY_TRAJECTORY_ID;

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

  async decision(id: string, body: Record<string, unknown>): Promise<void> {
    const active = this.activeAskQuestion;
    if (!active || `ask_question_${active.stepIndex}` !== id) {
      throw new Error('该问题已在原客户端回答或已过期');
    }

    const action = typeof body.action === 'string' ? body.action : 'submit';
    const cancelled = action === 'cancel';
    const answers = (
      body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)
        ? body.answers
        : {}
    ) as Record<string, string>;
    const questionDetails = (
      body.questionDetails &&
      typeof body.questionDetails === 'object' &&
      !Array.isArray(body.questionDetails)
        ? body.questionDetails
        : {}
    ) as Record<
      string,
      { selectedOptions?: string[]; writeIn?: string; skipped?: boolean }
    >;

    const responses = cancelled
      ? []
      : active.rawQuestions.map((q, idx) => {
          const qKey = q.question || `q_${idx + 1}`;
          const detail = questionDetails[qKey];
          const rawAns = String(answers[qKey] ?? '').trim();

          if (action === 'skip' || detail?.skipped || rawAns === '(Skipped)') {
            return {
              question: q.question,
              options: q.options,
              isMultiSelect: q.isMultiSelect,
              selectedOptionIds: [],
              writeInResponse: '',
              skipped: true,
            };
          }

          if (
            detail &&
            (Array.isArray(detail.selectedOptions) || typeof detail.writeIn === 'string')
          ) {
            const selOpts = Array.isArray(detail.selectedOptions) ? detail.selectedOptions : [];
            const selectedOptionIds = selOpts
              .map((sel) => q.options.find((o) => o.text === sel || o.id === sel)?.id)
              .filter((x): x is string => Boolean(x));
            const writeInResponse = typeof detail.writeIn === 'string' ? detail.writeIn.trim() : '';
            return {
              question: q.question,
              options: q.options,
              isMultiSelect: q.isMultiSelect,
              selectedOptionIds,
              writeInResponse,
              skipped: false,
            };
          }

          if (!q.isMultiSelect) {
            const matched = q.options.find((o) => o.text === rawAns || o.id === rawAns);
            if (matched) {
              return {
                question: q.question,
                options: q.options,
                isMultiSelect: false,
                selectedOptionIds: [matched.id],
                writeInResponse: '',
                skipped: false,
              };
            }
            return {
              question: q.question,
              options: q.options,
              isMultiSelect: false,
              selectedOptionIds: [],
              writeInResponse: rawAns,
              skipped: false,
            };
          }

          // Multi-select string fallback
          const directMatch = q.options.find((o) => o.text === rawAns || o.id === rawAns);
          if (directMatch) {
            return {
              question: q.question,
              options: q.options,
              isMultiSelect: true,
              selectedOptionIds: [directMatch.id],
              writeInResponse: '',
              skipped: false,
            };
          }
          const parts = rawAns
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          const selectedOptionIds: string[] = [];
          const unmatched: string[] = [];
          for (const part of parts) {
            const m = q.options.find((o) => o.text === part || o.id === part);
            if (m) {
              if (!selectedOptionIds.includes(m.id)) selectedOptionIds.push(m.id);
            } else {
              unmatched.push(part);
            }
          }
          return {
            question: q.question,
            options: q.options,
            isMultiSelect: true,
            selectedOptionIds,
            writeInResponse: unmatched.join(', '),
            skipped: false,
          };
        });

    const isTestEnv = !!process.env.AGENT_BOARD_ANTIGRAVITY_HOME;
    if (!isTestEnv) {
      const runner = await getAgentApiRunner(this.antigravityHome);
      let creds = await resolveAntigravityCredentials(runner?.exe);
      if (!creds) {
        throw new Error('未检测到 Antigravity 运行中的语言服务，请确保 Antigravity 原客户端正在运行');
      }

      let trajectoryId = active.trajectoryId;
      let stepIndex = active.stepIndex;
      if (!trajectoryId) {
        const lsCheck = await getAntigravityPendingAskQuestionStep(
          creds,
          this.session.nativeId,
          Math.max(0, active.stepIndex - 1),
        );
        if (lsCheck.status === 'waiting') {
          trajectoryId = lsCheck.step.trajectoryId;
          stepIndex = lsCheck.step.stepIndex;
        }
      }

      this.justSentAt = Date.now();
      let rpcRes = await submitAntigravityAskQuestion(creds, this.session.nativeId, {
        trajectoryId,
        stepIndex,
        responses,
        cancelled,
      });

      if (
        !rpcRes.ok &&
        (rpcRes.error?.includes('ECONNREFUSED') ||
          rpcRes.error?.includes('socket hang up') ||
          rpcRes.error?.includes('connection error') ||
          rpcRes.error?.includes('Unavailable') ||
          rpcRes.statusCode === 401 ||
          rpcRes.statusCode === 403)
      ) {
        invalidateAntigravityCredentialsCache();
        const freshCreds = await resolveAntigravityCredentials(runner?.exe);
        if (freshCreds) {
          creds = freshCreds;
          rpcRes = await submitAntigravityAskQuestion(creds, this.session.nativeId, {
            trajectoryId,
            stepIndex,
            responses,
            cancelled,
          });
        }
      }

      if (!rpcRes.ok) {
        throw new Error(`Antigravity 问题回答提交失败: ${rpcRes.error || '未知错误'}`);
      }

      this.activeAskQuestion = undefined;
      this.justSentAt = Date.now();
      setTimeout(() => {
        try {
          this.onUpdateCallback?.();
        } catch {}
      }, 80);
      return;
    }

    // Isolated test environment: append GENERIC answer record to transcript.jsonl
    const tPath = this.getTranscriptPath();
    const nowIso = new Date().toISOString();
    const answerLines = cancelled
      ? ['Cancelled by user']
      : responses.map((r, idx) => {
          if (r.skipped) return `A${idx + 1}: (Skipped)`;
          const optTexts = (r.selectedOptionIds ?? [])
            .map((id) => r.options.find((o) => o.id === id)?.text)
            .filter(Boolean);
          const combined = [
            ...optTexts,
            ...(r.writeInResponse ? [r.writeInResponse] : []),
          ].join(', ');
          return `A${idx + 1}: ${combined}`;
        });
    const genericRecord = {
      step_index: active.stepIndex,
      type: 'GENERIC',
      status: cancelled ? 'CANCELED' : 'DONE',
      created_at: nowIso,
      conversation_id: this.session.nativeId,
      content: `Created At: ${nowIso}\nCompleted At: ${nowIso}\n\n${answerLines.join('\n')}`,
    };
    await appendFile(tPath, JSON.stringify(genericRecord) + '\n', 'utf8');
    this.activeAskQuestion = undefined;
    this.justSentAt = Date.now();
    setTimeout(() => {
      try {
        this.onUpdateCallback?.();
      } catch {}
    }, 50);
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
