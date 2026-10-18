import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  Attention,
  DisplayEvent,
  EventPage,
  Execution,
  SessionView,
} from '../shared/types.js';
import { readPage, request } from './api.js';
import { InteractionPanel } from './InteractionPanel.js';
import { ToolEventView } from './ToolEventView.js';
import { MarkdownCodeBlock } from './MarkdownCodeBlock.js';
import { CopyButton } from './CopyButton.js';
import { useI18n } from './i18n/index.js';
import { playSound } from './sound.js';
import { AgentLogo } from './AgentLogo.js';
import {
  getPathBasename,
  isNonProjectPath,
  normalizePath,
  STORAGE_PROJECTS_KEY,
  type ProjectItem,
} from './NewSessionModal.js';
import styles from './Board.module.css';

function resolveProjectDisplay(cwd?: string): { name: string; path: string } | null {
  if (!cwd || !cwd.trim()) return null;
  const cleanPath = cwd.trim().replace(/\\\\/g, '\\');
  if (isNonProjectPath(cleanPath)) return null;
  const norm = normalizePath(cleanPath);
  try {
    const raw = localStorage.getItem(STORAGE_PROJECTS_KEY);
    if (raw) {
      const list = JSON.parse(raw) as ProjectItem[];
      const matched =
        list.find((p) => p.path && normalizePath(p.path) === norm) ??
        list.find((p) => p.path && norm.startsWith(`${normalizePath(p.path)}\\`));
      if (matched && matched.name) {
        return { name: matched.name, path: matched.path || cleanPath };
      }
    }
  } catch {}
  const base = getPathBasename(cleanPath);
  return { name: base || cleanPath, path: cleanPath };
}

function extractPreviewSnippet(
  items: DisplayEvent[] | undefined,
  fallbackReason: string,
): { roleIcon: string; text: string } {
  if (items && items.length > 0) {
    for (let i = items.length - 1; i >= 0; i--) {
      const ev = items[i];
      if (!ev || !ev.text || !ev.text.trim()) continue;
      if (ev.role === 'notice') continue;
      let cleaned = ev.text
        .replace(/```[\s\S]*?```/g, ' [代码] ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^[#>*\-\d.]+\s+/gm, '')
        .replace(/[*_~]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleaned) continue;
      if (cleaned.length > 100) {
        cleaned = cleaned.slice(0, 100) + '…';
      }
      const roleIcon = ev.role === 'user' ? '👤' : ev.role === 'tool' ? '🔧' : '🤖';
      return { roleIcon, text: cleaned };
    }
  }
  return { roleIcon: '', text: fallbackReason };
}

function formatShortTime(updatedAt: number, locale: string): string {
  if (!updatedAt || updatedAt <= 0) return '';
  const diffSec = Math.floor((Date.now() - updatedAt) / 1000);
  const isEn = locale === 'en-US';
  if (diffSec < 60) return isEn ? 'now' : '刚刚';
  if (diffSec < 3600) {
    const mins = Math.floor(diffSec / 60);
    return isEn ? `${mins}m` : `${mins}分钟前`;
  }
  const d = new Date(updatedAt);
  const now = new Date();
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function EventContent({ event }: { event: DisplayEvent }) {
  const { t, tr, formatTime } = useI18n();

  if (event.role === 'tool') {
    return (
      <div className={styles.event} data-role={event.role} data-event-id={event.id}>
        <ToolEventView event={event} />
      </div>
    );
  }
  return (
    <div className={styles.event} data-role={event.role} data-event-id={event.id}>
      <div className={styles.eventLabel}>
        <span className={styles.eventRole}>
          {event.label ? tr(event.label) : t.card.roles[event.role]}
        </span>
        <div className={styles.eventMeta}>
          {event.timestamp && (
            <time>
              {formatTime(event.timestamp)}
            </time>
          )}
          {event.text && (
            <CopyButton
              text={event.text}
              label={t.card.copyMessage}
              copiedLabel={t.common.copied}
              variant="message"
            />
          )}
        </div>
      </div>
      {event.role === 'notice' ? (
        <p className={styles.recordNotice}>{tr(event.text)}</p>
      ) : (
        <div className={styles.markdown}>
          <Markdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={{
              pre: ({ children, ...props }) => (
                <MarkdownCodeBlock {...props}>{children}</MarkdownCodeBlock>
              ),
              img: ({ alt }) => (
                <span className={styles.recordNotice}>{t.card.imageNotLoaded(alt)}</span>
              ),
              a: ({ href, children }) =>
                /^https?:\/\//i.test(href ?? '') ? (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {children} ↗
                  </a>
                ) : (
                  <span>{children}</span>
                ),
            }}
          >
            {event.text}
          </Markdown>
        </div>
      )}
    </div>
  );
}

export function SessionCard({
  session,
  onChange,
  newlyDiscovered,
  autoExpand,
  onExpandChange,
  initialPrompt,
  onOpenRemote,
}: {
  session: SessionView;
  newlyDiscovered: boolean;
  onChange: (action?: 'read' | 'archive' | 'unarchive') => Promise<void> | void;
  autoExpand?: boolean;
  onExpandChange?: (expanded: boolean) => void;
  initialPrompt?: string;
  onOpenRemote?: (session: SessionView) => void;
}) {
  const { t, tr, locale } = useI18n();
  const sessionTitle = tr(session.title);
  const sessionReason = tr(session.stateReason);
  const [page, setPage] = useState<EventPage>();
  const initTimestampRef = useRef(new Date().toISOString());
  const [optimisticEvents, setOptimisticEvents] = useState<DisplayEvent[]>(() => {
    if (initialPrompt && initialPrompt.trim()) {
      return [
        {
          id: `optimistic-init-${Date.now()}`,
          role: 'user',
          text: initialPrompt.trim(),
          timestamp: initTimestampRef.current,
        },
      ];
    }
    return [];
  });

  const [isGenerating, setIsGenerating] = useState(() =>
    Boolean((initialPrompt && initialPrompt.trim()) || session.execution === 'RUNNING'),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<EventPage>();
  const [expanded, setExpanded] = useState(() => Boolean(autoExpand));

  useEffect(() => {
    if (autoExpand) {
      setExpanded(true);
    }
  }, [autoExpand]);
  const [isArchiving, setIsArchiving] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const modalScroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const modalContent = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (!el || !expanded) return;
    if ('closedBy' in HTMLDialogElement.prototype) return;
    const handleBackdropClick = (event: MouseEvent) => {
      if (event.target !== el) return;
      const rect = el.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        el.close();
      }
    };
    el.addEventListener('click', handleBackdropClick);
    return () => el.removeEventListener('click', handleBackdropClick);
  }, [expanded]);
  const follow = useRef(true);
  const initial = useRef(true);
  const requestVersion = useRef(0);
  const inFlightReload = useRef(false);
  const pendingReload = useRef(false);
  const scrollPositions = useRef(new WeakMap<HTMLElement, number>());
  const historyAnchor = useRef<{
    el: HTMLDivElement;
    top: number;
    height: number;
  } | null>(null);
  const current = useRef(page);
  current.current = page;
  const endpoint = `/api/sessions/${session.id}/events`;

  const handleSend = (text: string) => {
    const optId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const optEvent: DisplayEvent = {
      id: optId,
      role: 'user',
      text,
      timestamp: new Date().toISOString(),
    };
    setOptimisticEvents((prev) => [...prev, optEvent]);
    setIsGenerating(true);
    follow.current = true;
  };

  const handleSendError = (text: string) => {
    setOptimisticEvents((prev) => prev.filter((e) => e.text !== text));
    setIsGenerating(false);
  };

  const executionLabel: Record<Execution, string> = {
    RUNNING: t.states.RUNNING,
    WAITING_INPUT: t.states.WAITING_INPUT,
    WAITING_APPROVAL: t.states.WAITING_APPROVAL,
    COMPLETED: t.states.COMPLETED,
    FAILED: t.states.FAILED_BADGE,
    IDLE: t.states.IDLE,
    UNKNOWN: t.states.UNKNOWN,
  };
  const attentionLabel: Record<Attention, string> = {
    BASELINE_EXISTING: t.states.BASELINE_EXISTING_BADGE,
    READ: t.states.READ,
    UNREAD_OUTPUT: t.states.UNREAD_OUTPUT,
    UNREAD_COMPLETION: t.states.UNREAD_COMPLETION,
    ARCHIVED: t.states.ARCHIVED,
  };

  const scrollBottom = () => {
    const el = expanded ? modalScroll.current : scroll.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      scrollPositions.current.set(el, el.scrollTop);
    }
  };

  useLayoutEffect(() => {
    if (expanded && !dialog.current?.open) {
      dialog.current?.showModal();
      scrollBottom();
    } else if (!expanded) dialog.current?.close();
    const anchor = historyAnchor.current;
    if (anchor) {
      anchor.el.scrollTop = anchor.top + anchor.el.scrollHeight - anchor.height;
      scrollPositions.current.set(anchor.el, anchor.el.scrollTop);
      historyAnchor.current = null;
    } else if (follow.current) scrollBottom();
  });

  useLayoutEffect(() => {
    const el = expanded ? modalScroll.current : scroll.current;
    const body = expanded ? modalContent.current : content.current;
    const observer = new ResizeObserver(() => {
      if (follow.current) scrollBottom();
    });
    if (el) observer.observe(el);
    if (body) observer.observe(body);
    return () => observer.disconnect();
  }, [expanded]);

  async function reload(force = false) {
    if (inFlightReload.current && !force) {
      pendingReload.current = true;
      return;
    }
    inFlightReload.current = true;
    pendingReload.current = false;
    const version = ++requestVersion.current;
    try {
      const fetchFn = expanded || autoExpand || force ? request : readPage;
      const result = await fetchFn<EventPage>(endpoint);
      if (version !== requestVersion.current) return;
      if (force || initial.current || follow.current) {
        follow.current = true;
        setPage(result);
        setPending(undefined);
        initial.current = false;
      } else if (result.items.at(-1)?.id !== current.current?.items.at(-1)?.id) setPending(result);
      else
        setPage((previous) =>
          previous ? { ...previous, snapshotCursor: result.snapshotCursor } : result,
        );
      setError('');
    } catch (e) {
      if (version === requestVersion.current) setError((e as Error).message);
    } finally {
      if (version === requestVersion.current) {
        inFlightReload.current = false;
        if (pendingReload.current) {
          pendingReload.current = false;
          void reload();
        }
      }
    }
  }

  useEffect(() => {
    return () => {
      requestVersion.current++;
      inFlightReload.current = false;
      pendingReload.current = false;
    };
  }, []);

  useEffect(() => {
    void reload();
  }, [session.revision]);

  useEffect(() => {
    if (!page?.items?.length) return;
    const hasUserInPage = page.items.some((i) => i.role === 'user');
    setOptimisticEvents((prev) => {
      if (prev.length === 0) return prev;
      let remaining = prev.filter((o) => !(hasUserInPage && o.id.startsWith('optimistic-init-')));
      for (const item of page.items) {
        if (item.role === 'user') {
          const itemText = item.text.trim();
          const idx = remaining.findIndex((o) => {
            const optText = o.text.trim();
            return optText === itemText || (optText.length > 0 && itemText.startsWith(optText));
          });
          if (idx !== -1) {
            remaining.splice(idx, 1);
          }
        }
      }
      return remaining;
    });
  }, [page?.items]);

  // Sync generating state when session.execution changes
  useEffect(() => {
    if (session.execution === 'RUNNING') {
      setIsGenerating(true);
      void reload();
    } else if (session.execution !== 'UNKNOWN') {
      if (optimisticEvents.length === 0) {
        setIsGenerating(false);
      }
      void reload();
    }
  }, [session.execution, optimisticEvents.length]);

  // When generating or running, periodically poll reload so tool calls and incoming events appear live
  useEffect(() => {
    if (!isGenerating && session.execution !== 'RUNNING') return;
    const interval = setInterval(() => {
      void reload();
    }, 1000);
    return () => clearInterval(interval);
  }, [isGenerating, session.execution]);

  // Clean up any unmatched follow-up optimistic events only after generation is genuinely finished
  // and native user records have been loaded. Never wipe out initial prompt before native records arrive.
  useEffect(() => {
    if (
      isGenerating ||
      session.execution === 'RUNNING' ||
      session.execution === 'UNKNOWN' ||
      optimisticEvents.length === 0 ||
      !page?.items?.some((i) => i.role === 'user')
    ) {
      return;
    }
    const timer = setTimeout(() => {
      setOptimisticEvents([]);
    }, 3000);
    return () => clearTimeout(timer);
  }, [isGenerating, session.execution, optimisticEvents.length, page?.items]);

  useLayoutEffect(() => {
    if (optimisticEvents.length > 0 || isGenerating) {
      scrollBottom();
    }
  }, [optimisticEvents.length, isGenerating]);

  async function older() {
    if (!page?.nextCursor || busy) return;
    setBusy(true);
    follow.current = false;
    const el = expanded ? modalScroll.current : scroll.current;
    const height = el?.scrollHeight ?? 0;
    const top = el?.scrollTop ?? 0;
    try {
      const result = await readPage<EventPage>(
        endpoint + '?cursor=' + encodeURIComponent(page.nextCursor),
      );
      const seen = new Set(page.items.map((e) => e.id));
      const items = [...result.items.filter((e) => !seen.has(e.id)), ...page.items];
      if (new TextEncoder().encode(JSON.stringify(items)).length > 5 * 1024 * 1024)
        throw new Error(t.card.bufferLimitError);
      if (el) historyAnchor.current = { el, top, height };
      setPage({
        ...page,
        items,
        nextCursor: result.nextCursor,
        truncated: result.truncated,
      });
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(action: 'read' | 'archive' | 'unarchive') {
    if (!page && action !== 'unarchive') return;
    if (action === 'archive') {
      playSound('archive');
      setIsArchiving(true);
      await new Promise((resolve) => setTimeout(resolve, 240));
    } else if (action === 'read') {
      playSound('click');
    }
    setBusy(true);
    try {
      await request(`/api/sessions/${session.id}/${action}`, {
        cursor: page?.snapshotCursor,
      });
      await onChange(action);
      setError('');
    } catch (e) {
      setIsArchiving(false);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function latest() {
    follow.current = true;
    if (pending) {
      setPage(pending);
      setPending(undefined);
    } else void reload(true);
  }

  const projectDisplay = resolveProjectDisplay(session.cwd);

  const toggleExpand = (next: boolean) => {
    setExpanded(next);
    onExpandChange?.(next);
    if (typeof window !== 'undefined') {
      try {
        const u = new URL(window.location.href);
        if (next && window.matchMedia('(max-width: 768px)').matches) {
          if (u.searchParams.get('session') !== session.id) {
            u.searchParams.set('session', session.id);
            window.history.pushState({ agentBoardSession: session.id }, '', u.toString());
          }
        } else if (!next && u.searchParams.get('session') === session.id) {
          u.searchParams.delete('session');
          window.history.replaceState(null, '', u.toString());
        }
      } catch {}
    }
  };

  useEffect(() => {
    if (!expanded || typeof window === 'undefined') return;
    const handlePopState = () => {
      try {
        const currentSession = new URLSearchParams(window.location.search).get('session');
        if (currentSession !== session.id) {
          setExpanded(false);
          onExpandChange?.(false);
        }
      } catch {}
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [expanded, session.id, onExpandChange]);

  const renderHeader = (isModal = false) => (
    <header className={styles.cardHeader}>
      {isModal && (
        <button
          type="button"
          className={styles.mobileBackBtn}
          onClick={(e) => {
            e.stopPropagation();
            toggleExpand(false);
          }}
          aria-label={t.card.backToBoard}
        >
          {t.card.backToBoard}
        </button>
      )}
      <div className={styles.cardIdentity}>
        <span className={styles.provider} data-provider={session.provider}>
          <AgentLogo provider={session.provider} />
        </span>
        <div>
          <h3
            title={
              projectDisplay
                ? `${sessionTitle}\n📁 ${projectDisplay.name} (${projectDisplay.path})`
                : sessionTitle
            }
          >
            {sessionTitle}
          </h3>
          <p>
            <span className={styles.cardProviderId} title={session.nativeId}>
              {session.provider === 'codex'
                ? 'Codex'
                : session.provider === 'antigravity'
                  ? 'Antigravity'
                  : 'Claude'}{' '}
              <span>· {session.nativeId.slice(0, 8)}</span>
            </span>
            {projectDisplay && (
              <span
                className={styles.cardProjectBadge}
                title={`${projectDisplay.name}\n${projectDisplay.path}`}
              >
                <strong className={styles.cardProjectName}>📁 {projectDisplay.name}</strong>
                <span className={styles.cardProjectPath}>{projectDisplay.path}</span>
              </span>
            )}
          </p>
        </div>
      </div>
      <div className={styles.cardHeaderActions} onClick={(e) => e.stopPropagation()}>
        {onOpenRemote && (
          <button
            type="button"
            className={styles.iconButton}
            title={t.card.openOnPhone}
            aria-label={t.card.openOnPhone}
            onClick={() => {
              playSound('click');
              onOpenRemote(session);
            }}
          >
            📱
          </button>
        )}
        <button
          type="button"
          className={styles.iconButton}
          aria-label={expanded ? t.card.collapseSession : t.card.expandSession}
          onClick={() => toggleExpand(!expanded)}
        >
          {expanded ? '↙' : '↗'}
        </button>
      </div>
    </header>
  );

  const activity = session.execution === 'UNKNOWN' ? session.activity : undefined;
  const previewInfo = extractPreviewSnippet(page?.items, sessionReason);
  const updatedTimeStr = formatShortTime(session.updatedAt, locale);
  const badges = (
    <div className={styles.badges}>
      <span
        className={styles.execution}
        data-state={session.execution}
        data-activity={activity?.label}
        title={
          activity
            ? t.card.activityTooltip(
                sessionReason,
                new Date(activity.observedAt).toLocaleTimeString(locale),
              )
            : sessionReason
        }
      >
        <i />
        {activity
          ? (activity.label === '近期有输出' ? t.card.recentOutput : t.card.noRecentUpdate)
          : executionLabel[session.execution]}
      </span>
      {newlyDiscovered && <span className={styles.attention}>{t.states.newDiscovered}</span>}
      <span className={styles.attention} data-state={session.attention}>
        {attentionLabel[session.attention]}
      </span>
    </div>
  );

  const providerName =
    session.provider === 'codex'
      ? 'Codex'
      : session.provider === 'antigravity'
        ? 'Antigravity'
        : 'Claude';

  const body = (isModal = false) => {
    const nativeItems = page?.items ?? [];
    const hasNativeUser = nativeItems.some((item) => item.role === 'user');
    const visibleOptimistic = optimisticEvents.filter((opt) => {
      if (hasNativeUser && opt.id.startsWith('optimistic-init-')) return false;
      const optText = opt.text.trim();
      return !nativeItems.some((item) => {
        if (item.role !== 'user') return false;
        const itemText = item.text.trim();
        return itemText === optText || (optText.length > 0 && itemText.startsWith(optText));
      });
    });
    const fallbackInitEvent: DisplayEvent[] =
      !hasNativeUser &&
      initialPrompt?.trim() &&
      !visibleOptimistic.some((opt) => opt.id.startsWith('optimistic-init-'))
        ? [
            {
              id: `optimistic-init-fallback-${session.id}`,
              role: 'user',
              text: initialPrompt.trim(),
              timestamp: initTimestampRef.current,
            },
          ]
        : [];
    const displayItems = [...nativeItems, ...fallbackInitEvent, ...visibleOptimistic];
    const lastItem = displayItems[displayItems.length - 1];
    const isLastEventAssistant = lastItem?.role === 'assistant';
    const showTyping = (isGenerating || session.execution === 'RUNNING') && !isLastEventAssistant;
    return (
      <div
        className={styles.scroll}
        ref={isModal ? modalScroll : scroll}
        onScroll={(event) => {
          const el = event.currentTarget;
          if (el !== (expanded ? modalScroll.current : scroll.current)) return;
          const previous = scrollPositions.current.get(el) ?? 0;
          const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 45;
          // A content/viewport resize may emit scroll without an upward user movement.
          if (!bottom && el.scrollTop < previous - 1) follow.current = false;
          else if (bottom && el.scrollTop > previous) follow.current = true;
          scrollPositions.current.set(el, el.scrollTop);
        }}
        tabIndex={0}
        aria-label={t.card.sessionContent(session.provider)}
      >
        <div ref={isModal ? modalContent : content}>
          {session.diagnostics.map((d) => (
            <p className={styles.recordNotice} key={d}>
              {tr(d)}
            </p>
          ))}
          {page?.nextCursor && (
            <button className={styles.historyButton} onClick={() => void older()} disabled={busy}>
              {t.card.loadEarlier}
            </button>
          )}
          {!page && !error && !displayItems.length && (
            <p className={styles.loading}>{t.card.readingNativeRecords}</p>
          )}
          {page && !displayItems.length && (
            <p className={styles.loading}>{t.card.noDisplayableRecords}</p>
          )}
          {displayItems.map((event, index) => (
            <div key={event.id}>
              {session.segments > 1 &&
                event.segment !== displayItems[index - 1]?.segment &&
                event.segment && (
                  <p className={styles.segment}>{t.card.nativeSegment(event.segment)}</p>
                )}
              <EventContent event={event} />
            </div>
          ))}
          {showTyping && (
            <div
              className={`${styles.event} ${styles.typingEvent}`}
              data-role="assistant"
            >
              <div className={styles.eventLabel}>
                <span>{providerName}</span>
              </div>
              <div className={styles.typingIndicator}>
                <span className={styles.typingText}>
                  {t.card.generatingReply(providerName)}
                </span>
                <span className={styles.typingDots} aria-hidden="true">
                  <span className={styles.typingDot} />
                  <span className={styles.typingDot} />
                  <span className={styles.typingDot} />
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const controls = (isModal = false) => (
    <>
      {(error || pending) && (
        <div className={styles.inlineStatus}>
          {error ? (
            <span role="alert">
              {error} <button onClick={() => void reload(true)}>{t.common.reload}</button>
            </span>
          ) : (
            <button onClick={latest}>{t.card.viewLatestOutput}</button>
          )}
        </div>
      )}
      {!isModal && (
        <div className={styles.interactAction}>
          <button
            className={styles.fullInteractBtn}
            data-urgent={
              session.execution === 'WAITING_APPROVAL' ||
              session.execution === 'WAITING_INPUT'
            }
            data-running={session.execution === 'RUNNING'}
            onClick={() => {
              playSound('click');
              toggleExpand(true);
            }}
            aria-label={t.card.interact}
          >
            {session.execution === 'WAITING_APPROVAL' ? '⚡ ' : ''}
            {t.card.interact}
          </button>
        </div>
      )}
      <footer className={styles.cardFooter}>
        <button disabled={busy || !page} onClick={() => void act('read')}>
          {t.card.markAsRead}
        </button>
        <button
          disabled={busy || (!page && !session.archived)}
          title={session.archived ? t.card.restoreTooltip : t.card.archiveTooltip}
          onClick={() => void act(session.archived ? 'unarchive' : 'archive')}
        >
          {session.archived ? t.card.restoreToBoard : t.card.archive}
        </button>
      </footer>
    </>
  );

  return (
    <>
      <article
        className={styles.card}
        data-session-id={session.id}
        data-order={session.order}
        data-execution={session.execution}
        data-attention={session.attention}
        data-archiving={isArchiving}
        onClick={(e) => {
          if (typeof window === 'undefined') return;
          if (!window.matchMedia('(max-width: 768px)').matches) return;
          const target = e.target as HTMLElement | null;
          if (target?.closest('button, a, input, select, textarea')) return;
          playSound('click');
          toggleExpand(true);
        }}
      >
        {renderHeader(false)}
        <div className={styles.mobileSessionSummary}>
          <p className={styles.mobileSessionPreview}>
            {previewInfo.roleIcon && (
              <span className={styles.mobilePreviewRole}>{previewInfo.roleIcon}</span>
            )}
            <span>{previewInfo.text}</span>
          </p>
          <div className={styles.mobileSessionMetaRow}>
            <div className={styles.mobileSessionBadges}>
              <span
                className={styles.execution}
                data-state={session.execution}
                data-activity={activity?.label}
              >
                <i />
                {activity
                  ? activity.label === '近期有输出'
                    ? t.card.recentOutput
                    : t.card.noRecentUpdate
                  : executionLabel[session.execution]}
              </span>
              {(session.attention === 'UNREAD_COMPLETION' ||
                session.attention === 'UNREAD_OUTPUT' ||
                newlyDiscovered) && (
                <span className={styles.attention} data-state={session.attention}>
                  {newlyDiscovered ? t.states.newDiscovered : attentionLabel[session.attention]}
                </span>
              )}
            </div>
            <span className={styles.mobileEnterHint}>
              {updatedTimeStr && <time>{updatedTimeStr}</time>}
              <span className={styles.mobileChevron} aria-hidden="true">
                ›
              </span>
            </span>
          </div>
        </div>
        {badges}
        {body()}
        {controls()}
      </article>
      <dialog
        ref={dialog}
        closedby="any"
        className={styles.dialog}
        onCancel={() => toggleExpand(false)}
        onClose={() => toggleExpand(false)}
        aria-label={t.card.sessionDetails(sessionTitle)}
      >
        {expanded && (
          <div className={styles.expandedCard}>
            {renderHeader(true)}
            {badges}
            {body(true)}
            <InteractionPanel
              id={session.id}
              onComplete={() => {
                void reload(true);
                void onChange();
                setIsGenerating(false);
              }}
              onSend={handleSend}
              onSendError={handleSendError}
              onPhaseChange={(phase) => {
                if (phase === 'RUNNING') {
                  setIsGenerating(true);
                } else if (
                  phase === 'READY' ||
                  phase === 'COMPLETED' ||
                  phase === 'FAILED'
                ) {
                  setIsGenerating(false);
                  void reload(true);
                  void onChange();
                }
              }}
            />
            {controls(true)}
          </div>
        )}
      </dialog>
    </>
  );
}
