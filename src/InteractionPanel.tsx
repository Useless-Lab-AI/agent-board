import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { InteractionView } from '../shared/interaction.js';
import { request } from './api.js';
import { useI18n } from './i18n/index.js';
import { playSound } from './sound.js';
import { CopyButton } from './CopyButton.js';
import { ChatComposer, type AttachedFileItem } from './ChatComposer.js';
import styles from './Board.module.css';

function SetupSnippet({ text }: { text: string }) {
  return (
    <div style={{ position: 'relative', margin: '4px 0' }}>
      <pre style={{ margin: 0, background: 'var(--c-eaf1ec)', padding: '6px 36px 6px 8px', borderRadius: 4, overflowX: 'auto', fontSize: '11px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {text}
      </pre>
      <div style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}>
        <CopyButton text={text} variant="tool" />
      </div>
    </div>
  );
}

function DiffDetailView({ detail }: { detail: string }) {
  const { t } = useI18n();
  const lines = detail.split('\n');
  const isDiff = lines.some(
    (l) => l.startsWith('+') || l.startsWith('-') || l.startsWith('@@'),
  );
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 2 }}>
        <CopyButton text={detail} label={t.common.copy} variant="tool" />
      </div>
      {!isDiff ? (
        <pre className={styles.diffBox}>{detail}</pre>
      ) : (
        <div className={styles.diffBox}>
          {lines.map((line, idx) => {
            let lineClass = styles.diffLine;
            if (line.startsWith('+') && !line.startsWith('+++')) {
              lineClass = `${styles.diffLine} ${styles.diffAdd}`;
            } else if (line.startsWith('-') && !line.startsWith('---')) {
              lineClass = `${styles.diffLine} ${styles.diffRemove}`;
            } else if (
              line.startsWith('//') ||
              line.startsWith('#') ||
              line.startsWith('/*')
            ) {
              lineClass = `${styles.diffLine} ${styles.diffComment}`;
            }
            return (
              <span key={idx} className={lineClass}>
                {line || ' '}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function InteractionPanel({
  id,
  onComplete,
  onSend,
  onSendError,
  onPhaseChange,
}: {
  id: string;
  onComplete: () => void;
  onSend?: (text: string) => void;
  onSendError?: (text: string) => void;
  onPhaseChange?: (phase: InteractionView['phase']) => void;
}) {
  const { t, tr } = useI18n();
  const [view, setView] = useState<InteractionView>();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [posting, setPosting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [attachments, setAttachments] = useState<AttachedFileItem[]>([]);
  const [answers, setAnswers] = useState<
    Record<string, Record<string, string>>
  >({});
  const output = useRef<HTMLPreElement>(null),
    follow = useRef(true);
  const current = useRef(view);
  current.current = view;
  const callback = useRef(onComplete);
  callback.current = onComplete;
  const phaseCallback = useRef(onPhaseChange);
  phaseCallback.current = onPhaseChange;
  const serial = useRef(0);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const base = `/api/sessions/${id}/interaction`;

  const labels: Record<InteractionView['phase'], string> = {
    OBSERVE_ONLY: t.interaction.phases.OBSERVE_ONLY,
    READY: t.interaction.phases.READY,
    QUEUED: t.interaction.phases.QUEUED,
    STARTING: t.interaction.phases.STARTING,
    RUNNING: t.interaction.phases.RUNNING,
    WAITING_APPROVAL: t.interaction.phases.WAITING_APPROVAL,
    WAITING_INPUT: t.interaction.phases.WAITING_INPUT,
    COMPLETED: t.interaction.phases.COMPLETED,
    FAILED: t.interaction.phases.FAILED,
    INTERRUPTED: t.interaction.phases.INTERRUPTED,
  };

  function accept(result: InteractionView) {
    const before = current.current;
    if (
      before &&
      before.serviceEpoch === result.serviceEpoch &&
      before.revision > result.revision
    )
      return;
    if (before && before.serviceEpoch !== result.serviceEpoch) {
      setError(t.interaction.serviceRestarted);
    }
    if (!before || before.phase !== result.phase) {
      phaseCallback.current?.(result.phase);
    }
    if (
      before &&
      before.phase !== result.phase &&
      (['COMPLETED', 'FAILED', 'INTERRUPTED'].includes(result.phase) ||
        (before.phase === 'RUNNING' && result.phase === 'READY'))
    ) {
      callback.current();
    }
    current.current = result;
    setView(result);
  }

  useEffect(() => {
    let disposed = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      refreshing = false;
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      const call = ++serial.current;
      try {
        const v = await request<InteractionView>(base);
        if (!disposed && call === serial.current) accept(v);
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      } finally {
        refreshing = false;
      }
    }
    refreshRef.current = refresh;
    const stream = new EventSource('/api/events');
    stream.onopen = () => {
      setConnected(true);
      void refresh();
    };
    stream.onerror = () => setConnected(false);
    stream.addEventListener('interaction', (event) => {
      if (JSON.parse((event as MessageEvent).data).id === id && !timer)
        timer = setTimeout(() => {
          timer = undefined;
          void refresh();
        }, 100);
    });
    void refresh();
    const poll = setInterval(() => void refresh(), 2000);
    return () => {
      disposed = true;
      serial.current++;
      stream.close();
      clearInterval(poll);
      if (timer) clearTimeout(timer);
    };
  }, [base, id]);

  useLayoutEffect(() => {
    if (follow.current && output.current)
      output.current.scrollTop = output.current.scrollHeight;
  }, [view?.output]);

  const busy =
    !!view &&
    ['STARTING', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_INPUT'].includes(
      view.phase,
    );

  async function post(action: string, body: Record<string, unknown>) {
    if (!view || posting) return;
    setPosting(true);
    setError('');
    serial.current++;
    try {
      const result = await request<InteractionView>(`${base}/${action}`, {
        serviceEpoch: view.serviceEpoch,
        runtimeEpoch: view.runtimeEpoch,
        ...body,
      });
      accept(result);
      if (action === 'send') {
        follow.current = true;
      }
    } catch (e) {
      setError(
        `${(e as Error).message}${action === 'send' ? t.interaction.sendErrorSuffix : ''}`,
      );
      if (action === 'send' && typeof body.text === 'string') {
        setDraft((cur) => (cur ? cur : (body.text as string)));
        onSendError?.(body.text);
      }
      void refreshRef.current();
    } finally {
      setPosting(false);
    }
  }

  const isOnline = connected || !!view?.connected;
  const isUploading = attachments.some((a) => a.uploading);
  const canSend =
    !!view &&
    view.canSend &&
    !posting &&
    !isUploading &&
    isOnline &&
    (!!draft.trim() || attachments.some((a) => !a.uploading && !a.error && a.localPath));

  return (
    <section className={styles.interaction} aria-label={t.interaction.heading}>
      <div className={styles.interactionHeading}>
        <strong>{view ? labels[view.phase] : t.interaction.checkingCapability}</strong>
        <span>{connected ? t.interaction.keepOriginalOpen : t.interaction.reconnecting}</span>
      </div>
      <p className={styles.interactionHint}>{tr(view?.reason)}</p>
      {view?.setup && !view.connected && (
        <details className={styles.runtimeOutput}>
          <summary>{t.interaction.claudeSetupTitle}</summary>
          <p style={{ margin: '8px 0 4px', color: 'var(--c-6d7f73)' }}>{t.interaction.claudeSetupReadonlyNotice}</p>
          <p style={{ margin: '4px 0 8px', fontWeight: 600 }}>{t.interaction.claudeSetupNotice}</p>

          <div style={{ margin: '10px 0', padding: '10px 12px', borderRadius: 8, background: 'var(--c-f4f7f5)', border: '1px solid var(--c-dce5df)' }}>
            <strong style={{ color: 'var(--c-274b35)' }}>{t.interaction.claudeSetupMethod1Title}</strong>
            <p style={{ margin: '6px 0 2px' }}>{t.interaction.claudeSetupMethod1Step1}</p>
            <SetupSnippet text={view.setup.quickstart || 'npm run setup'} />
            <p style={{ margin: '6px 0 2px' }}>{t.interaction.claudeSetupMethod1Step2}</p>
            <SetupSnippet text={view.setup.recommendedCommand || 'claude-board'} />
          </div>

          <details style={{ margin: '8px 0' }}>
            <summary style={{ cursor: 'pointer', color: 'var(--c-52685a)', fontWeight: 500 }}>{t.interaction.claudeSetupMethod2Title}</summary>
            <p style={{ margin: '6px 0 2px' }}>{t.interaction.claudeSetupStep1}</p>
            <SetupSnippet text={view.setup.config} />
            <p style={{ margin: '6px 0 2px' }}>{t.interaction.claudeSetupStep2}</p>
            <SetupSnippet text={view.setup.command} />
          </details>

          <p style={{ margin: '10px 0 4px', fontSize: '11px', color: 'var(--c-77857d)' }}>{t.interaction.claudeSetupStep3}</p>
        </details>
      )}
      {view?.output && (
        <details
          open={busy}
          key={busy ? 'active' : 'finished'}
          className={styles.runtimeOutput}
        >
          <summary style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>
              {t.interaction.channelReply}
              {view.truncated ? t.interaction.earlierTruncated : ''}
            </span>
            <CopyButton text={view.output} label={t.common.copy} variant="tool" />
          </summary>
          <pre
            ref={output}
            onScroll={(e) => {
              const el = e.currentTarget;
              follow.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
          >
            {view.output}
          </pre>
        </details>
      )}
      <div className={styles.requests}>
        {view?.pending.map((p) => (
          <div key={p.id} className={styles.permission}>
            <div className={styles.permissionHeader}>
              <span>⚡ {tr(p.title)}</span>
            </div>
            {p.detail && <DiffDetailView detail={p.detail} />}
            {p.kind === 'approval' ? (
              <div className={styles.interactionActions}>
                <button
                  className={styles.denyButton}
                  disabled={posting || !isOnline}
                  onClick={() => {
                    playSound('click');
                    void post('decision', {
                      providerRequestId: p.id,
                      decision: 'deny',
                    });
                  }}
                >
                  {t.interaction.deny}
                </button>
                <button
                  className={styles.allowButton}
                  disabled={posting || !isOnline}
                  onClick={() => {
                    playSound('approve');
                    void post('decision', {
                      providerRequestId: p.id,
                      decision: 'allow',
                    });
                  }}
                >
                  ✓ {t.interaction.allow}
                </button>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void post('decision', {
                    providerRequestId: p.id,
                    answers: answers[p.id] ?? {},
                  });
                }}
              >
                {p.questions?.map((q) => (
                  <label key={q.id}>
                    {q.text}
                    {q.options.length > 0 && (
                      <small>
                        {t.interaction.options}{q.options.join(' / ')}
                        {q.multiple ? t.interaction.multipleAllowed : ''}
                      </small>
                    )}
                    <input
                      required
                      value={answers[p.id]?.[q.id] ?? ''}
                      onChange={(e) =>
                        setAnswers((a) => ({
                          ...a,
                          [p.id]: { ...a[p.id], [q.id]: e.target.value },
                        }))
                      }
                    />
                  </label>
                ))}
                <button disabled={posting || !isOnline}>{t.interaction.submitAnswer}</button>
              </form>
            )}
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className={styles.interactionError}>
          {error}
        </p>
      )}
      {view?.available && view.phase !== 'OBSERVE_ONLY' && (() => {
        const submitSend = () => {
          if (!canSend) return;
          const textToSend = draft;
          const readyAttachments = attachments
            .filter((a) => !a.uploading && !a.error && a.localPath)
            .map((a) => ({
              id: a.id,
              name: a.name,
              size: a.size,
              mimeType: a.mimeType,
              localPath: a.localPath!,
              url: a.url!,
            }));
          setDraft('');
          setAttachments([]);
          onSend?.(textToSend);
          const sendPayload: Record<string, unknown> = {
            text: textToSend,
            requestId: crypto.randomUUID(),
          };
          if (readyAttachments.length > 0) {
            sendPayload.attachments = readyAttachments;
          }
          void post('send', sendPayload);
        };
        return (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitSend();
            }}
          >
            <ChatComposer
              sessionId={id}
              value={draft}
              onChange={(val) => {
                setDraft(val);
                if (error) setError('');
              }}
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              onSubmit={submitSend}
              placeholder={
                busy
                  ? t.interaction.composerBusyPlaceholder
                  : t.interaction.composerPlaceholder
              }
              ariaLabel={t.interaction.composerAria}
              label={t.interaction.composerLabel}
              onError={setError}
            />

            <div className={styles.interactionActions}>
              <small>{t.interaction.composerHint}</small>
              {view.canInterrupt && (
                <button
                  type="button"
                  disabled={posting || !isOnline}
                  onClick={() => void post('interrupt', {})}
                >
                  {t.interaction.stop}
                </button>
              )}
              <button disabled={!canSend}>
                {posting
                  ? t.interaction.sending
                  : isUploading
                    ? t.interaction.uploading
                    : busy
                      ? labels[view.phase] || t.interaction.phases.RUNNING
                      : t.interaction.send}
              </button>
            </div>
          </form>
        );
      })()}
      {view?.available && view.phase === 'OBSERVE_ONLY' && (
        <div className={styles.runtimeOutput}>
          <p style={{ margin: '8px 0', color: 'var(--c-66776c)', fontSize: '12px' }}>
            {tr(view.reason) || t.interaction.observeOnlyHint}
          </p>
        </div>
      )}
    </section>
  );
}
