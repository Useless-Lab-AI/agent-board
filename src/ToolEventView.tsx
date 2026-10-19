import { useState, useCallback } from 'react';
import type { DisplayEvent } from '../shared/types.js';
import { useI18n, zhCN, type Translations } from './i18n/index.js';
import { CopyButton } from './CopyButton.js';
import styles from './Board.module.css';

export interface ParsedQuestionItem {
  question: string;
  options: string[];
  multiple?: boolean;
}

export interface ParsedToolCall {
  commands: string[];
  otherCalls: { fn: string; argsRaw: string }[];
  parsedJson: Record<string, any> | null;
  questions: ParsedQuestionItem[];
  summary: string;
  detailType: 'terminal' | 'file' | 'sleep' | 'message' | 'question' | 'tool';
}

export function parseToolCall(
  text: string,
  label = '',
  t: Translations = zhCN,
): ParsedToolCall {
  const commands: string[] = [];
  const otherCalls: { fn: string; argsRaw: string }[] = [];
  const questions: ParsedQuestionItem[] = [];
  let summary = '';
  let detailType: ParsedToolCall['detailType'] = 'tool';

  // 1. Check for Codex exec_command
  const execCmdRegex =
    /tools\.exec_command\(\s*\{[\s\S]*?cmd:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`([\s\S]*?)`)/g;
  let match: RegExpExecArray | null;
  while ((match = execCmdRegex.exec(text)) !== null) {
    const rawCmd = match[1] ?? match[2] ?? match[3] ?? '';
    try {
      if (match[1] !== undefined) commands.push(JSON.parse(`"${rawCmd}"`));
      else if (match[2] !== undefined)
        commands.push(rawCmd.replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
      else commands.push(rawCmd);
    } catch {
      commands.push(rawCmd);
    }
  }

  // 2. Check for other tools.* calls
  const otherToolRegex = /tools\.([a-zA-Z0-9_]+)\(([\s\S]*?)\)/g;
  while ((match = otherToolRegex.exec(text)) !== null) {
    const fn = match[1];
    if (fn !== 'exec_command') {
      const argsRaw = match[2].trim();
      otherCalls.push({ fn, argsRaw });
    }
  }

  // 3. Check for Claude JSON input or function call arguments JSON
  let parsedJson: Record<string, any> | null = null;
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      parsedJson = JSON.parse(trimmed);
      if (parsedJson?.command || parsedJson?.cmd || parsedJson?.CommandLine) {
        commands.push(parsedJson.command || parsedJson.cmd || parsedJson.CommandLine);
      }
      if (Array.isArray(parsedJson?.questions)) {
        for (const q of parsedJson.questions) {
          if (!q || typeof q !== 'object') continue;
          const qText = typeof q.question === 'string' ? q.question.trim() : '';
          if (!qText) continue;
          const optsRaw = Array.isArray(q.options) ? q.options : [];
          const options = optsRaw
            .map((o: any) =>
              typeof o === 'string'
                ? o.trim()
                : o && typeof o === 'object'
                  ? String(o.text ?? o.label ?? '').trim()
                  : '',
            )
            .filter(Boolean);
          questions.push({
            question: qText,
            options,
            multiple: Boolean(q.is_multi_select ?? q.isMultiSelect ?? q. multiSelect ?? q.multiple),
          });
        }
      }
    } catch {}
  }

  // Determine summary and detail type
  if (questions.length > 0) {
    detailType = 'question';
    if (parsedJson?.toolSummary && typeof parsedJson.toolSummary === 'string') {
      summary = parsedJson.toolSummary;
    } else {
      summary = questions[0].question;
      if (questions.length > 1) {
        summary += ` (+${questions.length - 1})`;
      }
    }
  } else if (commands.length > 0) {
    detailType = 'terminal';
    summary = commands[0].replace(/\r?\n/g, ' ').trim();
    if (commands.length > 1) summary += t.tools.moreCommands(commands.length - 1);
    else if (otherCalls.length > 0) summary += t.tools.moreActions(otherCalls.length);
  } else if (otherCalls.length > 0) {
    detailType = 'tool';
    const first = otherCalls[0];
    if (first.fn === 'view_image') {
      const pathMatch = first.argsRaw.match(/path:\s*["']([^"']+)["']/);
      summary = pathMatch
        ? t.tools.viewImage(pathMatch[1].split(/[/\\]/).pop())
        : t.tools.viewImage();
    } else if (first.fn === 'write_stdin') {
      summary = t.tools.inputStdin;
    } else if (first.fn === 'get_goal') {
      summary = t.tools.checkGoal;
    } else {
      summary = t.tools.callFn(first.fn);
    }
    if (otherCalls.length > 1) summary += t.tools.moreActions(otherCalls.length - 1);
  } else if (parsedJson) {
    const filePath =
      parsedJson.file_path ||
      parsedJson.path ||
      parsedJson.AbsolutePath ||
      parsedJson.TargetFile;
    if (filePath) {
      detailType = 'file';
      const fp = String(filePath);
      const filename = fp.split(/[/\\]/).pop() || fp;
      if (parsedJson.pattern || parsedJson.query) {
        summary = t.tools.searchInFile(parsedJson.pattern || parsedJson.query, filename);
      } else if (
        label === 'Edit' ||
        label === 'replace_file_content' ||
        parsedJson.old_string !== undefined ||
        parsedJson.ReplacementContent !== undefined
      ) {
        summary = t.tools.editFile(filename);
      } else if (
        label === 'Write' ||
        label === 'write_to_file' ||
        parsedJson.content !== undefined ||
        parsedJson.CodeContent !== undefined
      ) {
        summary = t.tools.writeFile(filename);
      } else if (label === 'Read' || label === 'view_file') {
        summary = t.tools.readFile(filename);
      } else {
        summary = fp;
      }
    } else if (parsedJson.duration_ms) {
      detailType = 'sleep';
      summary = t.tools.waitDuration((parsedJson.duration_ms / 1000).toFixed(1));
    } else if (parsedJson.target) {
      detailType = 'message';
      summary = t.tools.sendMessageTo(parsedJson.target);
    } else if (parsedJson.toolSummary && typeof parsedJson.toolSummary === 'string') {
      summary = parsedJson.toolSummary;
    } else {
      summary = Object.entries(parsedJson)
        .slice(0, 2)
        .map(
          ([k, v]) =>
            `${k}: ${typeof v === 'object' ? '...' : String(v).slice(0, 30)}`,
        )
        .join(', ');
    }
  } else {
    summary = text.split('\n')[0].slice(0, 80);
  }

  return { commands, otherCalls, parsedJson, questions, summary, detailType };
}

export interface ParsedToolResult {
  wallTime: number | null;
  exitCode: number | null;
  originalTokens: number | null;
  output: string;
  lineCount: number;
  images: string[];
  isError: boolean;
  summary: string;
}

export function parseToolResult(
  text: string,
  isErrorLabel = false,
  t: Translations = zhCN,
): ParsedToolResult {
  let wallTime: number | null = null;
  let wrapperTime: number | null = null;
  let exitCode: number | null = null;
  let originalTokens: number | null = null;
  const outputs: string[] = [];
  const images: string[] = [];

  function extractFromObject(obj: any) {
    if (!obj || typeof obj !== 'object') return;
    if (obj.wall_time_seconds !== undefined && wallTime === null)
      wallTime = Number(obj.wall_time_seconds);
    if (obj.exit_code !== undefined && exitCode === null)
      exitCode = Number(obj.exit_code);
    if (obj.original_token_count !== undefined && originalTokens === null)
      originalTokens = Number(obj.original_token_count);
    if (obj.image_url && typeof obj.image_url === 'string')
      images.push(obj.image_url);
    if (typeof obj.output === 'string') outputs.push(obj.output);
    if (typeof obj.stdout === 'string') outputs.push(obj.stdout);
    if (typeof obj.stderr === 'string') {
      outputs.push(obj.stderr);
      if (exitCode === null) exitCode = 1;
    }
    if (obj.error) {
      outputs.push(
        typeof obj.error === 'string'
          ? obj.error
          : JSON.stringify(obj.error, null, 2),
      );
      if (exitCode === null) exitCode = 1;
    }
    if (obj.value && typeof obj.value === 'object')
      extractFromObject(obj.value);
  }

  const trimmed = text.trim();
  if (
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('{') && trimmed.endsWith('}'))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item?.type === 'input_image' && item.image_url) {
            images.push(item.image_url);
          } else if (item?.text) {
            const timeMatch = item.text.match(/Wall time\s+([0-9.]+)\s+seconds/i);
            if (timeMatch) {
              wrapperTime = parseFloat(timeMatch[1]);
            }
            const innerTrimmed = item.text.trim();
            if (
              (innerTrimmed.startsWith('{') && innerTrimmed.endsWith('}')) ||
              (innerTrimmed.startsWith('[') && innerTrimmed.endsWith(']'))
            ) {
              try {
                const inner = JSON.parse(innerTrimmed);
                extractFromObject(inner);
                continue;
              } catch {}
            }
            // Strip sandbox wrapper boilerplate: "Script completed\nWall time ...\nOutput:\n"
            if (
              /^\s*Script completed\s*\n\s*Wall time[\s\S]*?Output:\s*$/i.test(
                item.text,
              )
            ) {
              continue;
            }
            outputs.push(item.text);
          } else {
            extractFromObject(item);
          }
        }
      } else {
        extractFromObject(parsed);
      }
    } catch {
      outputs.push(text);
    }
  } else {
    outputs.push(text);
  }

  // Antigravity command execution parsing
  const exitMatch = text.match(/The command exited with code\s+(-?\d+)/i);
  if (exitMatch && exitCode === null) {
    exitCode = parseInt(exitMatch[1], 10);
  }
  const createdMatch = text.match(/Created At:\s*([^\r\n]+)/i);
  const completedMatch = text.match(/Completed At:\s*([^\r\n]+)/i);
  if (createdMatch && completedMatch && wallTime === null) {
    try {
      const start = new Date(createdMatch[1].trim()).getTime();
      const end = new Date(completedMatch[1].trim()).getTime();
      if (!isNaN(start) && !isNaN(end) && end >= start) {
        wallTime = (end - start) / 1000;
      }
    } catch {}
  }
  if (exitMatch) {
    const outputIdx = text.indexOf('Output:\n');
    if (outputIdx !== -1) {
      outputs.length = 0;
      outputs.push(text.slice(outputIdx + 8));
    }
  }

  let isQuestionAnswer = false;
  if (createdMatch && completedMatch && !exitMatch) {
    const stripped = text
      .replace(/^Created At:\s*[^\r\n]+\r?\n/i, '')
      .replace(/^Completed At:\s*[^\r\n]+\r?\n*/i, '')
      .trim();
    if (/^(?:A\d+:\s*|Cancelled by user)/i.test(stripped)) {
      isQuestionAnswer = true;
      outputs.length = 0;
      outputs.push(stripped);
    }
  }

  if (wallTime === null) wallTime = wrapperTime;

  const cleanOutput = outputs.join('\n').replace(/\r\n/g, '\n').trim();
  const lineCount = cleanOutput ? cleanOutput.split('\n').length : 0;
  const isError = isErrorLabel || (exitCode !== null && exitCode !== 0);

  // Generate summary
  let summary = '';
  if (isQuestionAnswer && cleanOutput) {
    const oneLine = cleanOutput.replace(/\s+/g, ' ').trim();
    summary = t.interaction.answeredSummary(
      oneLine.length > 72 ? `${oneLine.slice(0, 72)}…` : oneLine,
    );
  } else if (isError) {
    summary = t.tools.failedStatus(exitCode ?? 1);
    if (wallTime !== null) summary += t.tools.durationSuffix(wallTime.toFixed(1));
  } else {
    summary = t.tools.completedStatus;
    if (wallTime !== null) summary += t.tools.durationSuffix(wallTime.toFixed(1));
    if (exitCode !== null) summary += t.tools.exitCodeSuffix(exitCode);
    if (lineCount > 0) summary += t.tools.linesSuffix(lineCount);
  }

  return {
    wallTime,
    exitCode,
    originalTokens,
    output: cleanOutput,
    lineCount,
    images,
    isError,
    summary,
  };
}

export function ToolCallView({
  event,
  defaultOpen = false,
  onQuickInteract,
}: {
  event: DisplayEvent;
  defaultOpen?: boolean;
  onQuickInteract?: () => void;
}) {
  const { t, formatTime } = useI18n();
  const label = !event.label || event.label === '工具调用' ? t.tools.callTitle : event.label;
  const parsed = parseToolCall(event.text, label, t);
  const [expanded, setExpanded] = useState(defaultOpen);

  const icon =
    parsed.detailType === 'question'
      ? '?'
      : parsed.detailType === 'terminal'
        ? '>_'
        : parsed.detailType === 'file'
          ? '📄'
          : parsed.detailType === 'sleep'
            ? '⏳'
            : parsed.detailType === 'message'
              ? '✉'
              : '⚡';

  const fullCommand = parsed.commands.join('\n');
  const copyTarget = fullCommand || event.text;

  return (
    <div
      className={styles.toolBlock}
      data-expanded={expanded}
      data-question={parsed.detailType === 'question'}
    >
      <button
        type="button"
        className={styles.toolHeader}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        title={expanded ? t.tools.collapseCall : t.tools.expandCall}
      >
        <div className={styles.toolHeaderLeft}>
          <span
            className={styles.toolBadge}
            data-kind={parsed.detailType === 'question' ? 'question' : 'call'}
          >
            <i>{icon}</i>
            <span>{label}</span>
          </span>
          <span className={styles.toolSummary} title={parsed.summary}>
            {parsed.summary}
          </span>
        </div>
        <div className={styles.toolHeaderRight}>
          {event.timestamp && <time>{formatTime(event.timestamp)}</time>}
          <span className={styles.toolChevron} data-open={expanded}>
            {expanded ? '▾' : '▸'}
          </span>
        </div>
      </button>

      {expanded && (
        <div className={styles.toolBody}>
          {parsed.questions.length > 0 ? (
            <div className={styles.toolQuestionList}>
              {parsed.questions.map((q, qIdx) => (
                <div key={qIdx} className={styles.toolQuestionItem}>
                  <div className={styles.toolQuestionHeader}>
                    <span className={styles.nativeQuestionBadge} aria-hidden="true">
                      ?
                    </span>
                    <span className={styles.toolQuestionTitle}>
                      {q.question}
                      {q.multiple && (
                        <small className={styles.nativeQuestionMultiHint}>
                          {t.interaction.multipleAllowed}
                        </small>
                      )}
                    </span>
                    {parsed.questions.length > 1 && (
                      <span className={styles.nativeQuestionPagerText}>
                        {t.interaction.questionStepOf(qIdx + 1, parsed.questions.length)}
                      </span>
                    )}
                  </div>
                  {q.options.length > 0 && (
                    <div className={styles.toolQuestionOptions}>
                      {q.options.map((opt, optIdx) =>
                        onQuickInteract ? (
                          <button
                            key={optIdx}
                            type="button"
                            className={styles.nativeQuestionOptionRow}
                            onClick={onQuickInteract}
                          >
                            <span className={styles.nativeQuestionOptNum}>{optIdx + 1}</span>
                            <span className={styles.nativeQuestionOptText}>{opt}</span>
                          </button>
                        ) : (
                          <div key={optIdx} className={styles.toolQuestionOptionStatic}>
                            <span className={styles.nativeQuestionOptNum}>{optIdx + 1}</span>
                            <span className={styles.nativeQuestionOptText}>{opt}</span>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : parsed.commands.length > 0 ? (
            <div className={styles.toolTerminal}>
              <div className={styles.toolTerminalBar}>
                <span>{t.tools.commandsCount(parsed.commands.length)}</span>
                <CopyButton text={copyTarget} label={t.tools.copyCommand} variant="tool" />
              </div>
              <pre className={styles.toolTerminalContent}>
                {parsed.commands.map((cmd, i) => (
                  <div key={i} className={styles.toolCmdLine}>
                    <span className={styles.toolPrompt}>$ </span>
                    <span>{cmd}</span>
                  </div>
                ))}
              </pre>
            </div>
          ) : (
            <div className={styles.toolTerminal}>
              <div className={styles.toolTerminalBar}>
                <span>{t.tools.callContent}</span>
                <CopyButton text={event.text} label={t.common.copy} variant="tool" />
              </div>
              <pre className={styles.toolTerminalContent}>{event.text}</pre>
            </div>
          )}

          {parsed.otherCalls.length > 0 && (
            <div className={styles.toolOtherCalls}>
              {parsed.otherCalls.map((c, i) => (
                <div key={i} className={styles.toolOtherItem}>
                  <strong>tools.{c.fn}</strong>
                  <span>{c.argsRaw}</span>
                </div>
              ))}
            </div>
          )}

          <details className={styles.toolRawDetails}>
            <summary>{t.tools.viewRawParameters}</summary>
            <pre>{event.text}</pre>
          </details>
        </div>
      )}
    </div>
  );
}

export function ToolResultView({ event }: { event: DisplayEvent }) {
  const { t, formatTime } = useI18n();
  const isErrorLabel = event.label === '工具错误' || event.label === t.tools.errorTitle;
  const parsed = parseToolResult(event.text, isErrorLabel, t);
  // Errors default to open, successes default to collapsed
  const [expanded, setExpanded] = useState(parsed.isError);
  const badgeLabel =
    !event.label || event.label === '工具结果' || event.label === '工具错误'
      ? parsed.isError
        ? t.tools.errorTitle
        : t.tools.resultTitle
      : event.label;

  return (
    <div
      className={styles.toolBlock}
      data-error={parsed.isError}
      data-expanded={expanded}
    >
      <button
        type="button"
        className={styles.toolHeader}
        data-error={parsed.isError}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        title={expanded ? t.tools.collapseResult : t.tools.expandResult}
      >
        <div className={styles.toolHeaderLeft}>
          <span
            className={styles.toolBadge}
            data-kind="result"
            data-error={parsed.isError}
          >
            <i>{parsed.isError ? '✕' : '✓'}</i>
            <span>{badgeLabel}</span>
          </span>
          <span
            className={styles.toolSummary}
            data-error={parsed.isError}
            title={parsed.summary}
          >
            {parsed.summary}
          </span>
        </div>

        <div className={styles.toolHeaderRight}>
          {parsed.exitCode !== null && (
            <span
              className={styles.toolStatusPill}
              data-state={parsed.exitCode === 0 ? 'success' : 'error'}
            >
              exit {parsed.exitCode}
            </span>
          )}
          {parsed.wallTime !== null && (
            <span className={styles.toolStatusPill} data-state="neutral">
              {parsed.wallTime.toFixed(1)}s
            </span>
          )}
          {event.timestamp && (
            <time>
              {formatTime(event.timestamp)}
            </time>
          )}
          <span className={styles.toolChevron} data-open={expanded}>
            {expanded ? '▾' : '▸'}
          </span>
        </div>
      </button>

      {expanded && (
        <div className={styles.toolBody}>
          {parsed.images.length > 0 && (
            <div className={styles.toolImagesList}>
              {parsed.images.map((img, i) => (
                <div key={i} className={styles.toolImageCard}>
                  <span>{t.tools.imageArtifact(i + 1)}</span>
                  <CopyButton text={img} label={t.tools.copyImageData} variant="tool" />
                </div>
              ))}
            </div>
          )}

          <div className={styles.toolTerminal}>
            <div className={styles.toolTerminalBar}>
              <span>
                {t.tools.outputWithLines(parsed.lineCount)}
              </span>
              <CopyButton text={parsed.output || event.text} label={t.tools.copyOutput} variant="tool" />
            </div>
            <pre className={styles.toolTerminalContent}>
              {parsed.output || <span className={styles.toolEmpty}>{t.tools.noOutput}</span>}
            </pre>
          </div>

          <div className={styles.toolMetaFooter}>
            {parsed.wallTime !== null && (
              <span>{t.tools.wallTime(parsed.wallTime.toFixed(2))}</span>
            )}
            {parsed.exitCode !== null && (
              <span>{t.tools.exitCode(parsed.exitCode)}</span>
            )}
            {parsed.originalTokens !== null && (
              <span>{t.tools.originalTokens(parsed.originalTokens)}</span>
            )}
            {parsed.lineCount > 0 && <span>{t.tools.lineCount(parsed.lineCount)}</span>}
          </div>

          <details className={styles.toolRawDetails}>
            <summary>{t.tools.viewRawJson}</summary>
            <pre>{event.text}</pre>
          </details>
        </div>
      )}
    </div>
  );
}

export function ToolEventView({
  event,
  defaultOpen = false,
  onQuickInteract,
}: {
  event: DisplayEvent;
  defaultOpen?: boolean;
  onQuickInteract?: () => void;
}) {
  const { t } = useI18n();
  const isResult =
    event.label === '工具结果' ||
    event.label === '工具错误' ||
    event.label === t.tools.resultTitle ||
    event.label === t.tools.errorTitle;
  if (isResult) {
    return <ToolResultView event={event} />;
  }
  return (
    <ToolCallView
      event={event}
      defaultOpen={defaultOpen}
      onQuickInteract={onQuickInteract}
    />
  );
}
