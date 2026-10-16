import { useCallback, useEffect, useRef, useState } from 'react';
import type { Provider, SessionList, SessionView } from '../shared/types.js';
import { request } from './api.js';
import { SessionCard } from './SessionCard.js';
import { AgentLogo } from './AgentLogo.js';
import { NewSessionModal } from './NewSessionModal.js';
import { ThemeSwitcher } from './ThemeSwitcher.js';
import { I18nProvider, LanguageSwitcher, useI18n } from './i18n/index.js';
import { isSoundEnabled, setSoundEnabled, playSound } from './sound.js';
import styles from './Board.module.css';

function BoardApp() {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [sources, setSources] = useState<SessionList['sources']>([]);
  const [provider, setProvider] = useState('');
  const [filter, setFilter] = useState('');
  const [archive, setArchive] = useState(false);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [pages, setPages] = useState(1);
  const pagesRef = useRef(1);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const serial = useRef(0);
  const [discovering, setDiscovering] = useState(false);
  const openedAt = useRef(Date.now());
  const firstLoad = useRef(true);
  const [hasPendingReorder, setHasPendingReorder] = useState(false);
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled());
  const prevWaiting = useRef(new Set<string>());

  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newModalProvider, setNewModalProvider] = useState<Provider>('antigravity');
  const [autoExpandId, setAutoExpandId] = useState<string | null>(null);
  const [lastActiveCwd, setLastActiveCwd] = useState<string>('');

  const handleOpenNewSession = (p: Provider) => {
    setNewModalProvider(p);
    setNewModalOpen(true);
    playSound('click');
  };

  const [newSessionPrompts, setNewSessionPrompts] = useState<Record<string, string>>({});

  const handleNewSessionSuccess = (
    newId?: string,
    newSession?: SessionView | null,
    initialPrompt?: string,
  ) => {
    if (newId && initialPrompt) {
      setNewSessionPrompts((prev) => ({ ...prev, [newId]: initialPrompt }));
    }
    if (newSession && newId) {
      setSessions((prev) => {
        if (prev.some((s) => s.id === newId)) return prev;
        return [newSession, ...prev];
      });
      setAutoExpandId(newId);
    } else if (newId) {
      setAutoExpandId(newId);
    }
    void refresh({ manual: true });
  };

  const inFlightManual = useRef(false);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
    if (next) playSound('click');
  };

  const refresh = useCallback(
    async ({ manual = false }: { manual?: boolean } = {}) => {
      if (!manual && inFlightManual.current) return;
      if (manual) inFlightManual.current = true;
      const call = ++serial.current;
      try {
        const rows: SessionView[] = [];
        let cursor: string | null = null;
        let lastResult: SessionList | undefined;
        const totalPages = pagesRef.current;
        for (let i = 0; i < totalPages; i++) {
          const query = new URLSearchParams({
            archive: String(archive),
            pageSize: '12',
          });
          if (provider) query.set('provider', provider);
          if (filter) query.set('state', filter);
          if (cursor) query.set('cursor', cursor);
          const result = await request<SessionList & { error?: string }>('/api/sessions?' + query);
          if ('error' in result && result.error) throw new Error(String(result.error));
          rows.push(...result.sessions);
          cursor = result.nextCursor;
          lastResult = result;
          if (!cursor) break;
        }
        if (call !== serial.current || !lastResult) return;
        if (firstLoad.current && !lastResult.initializing) {
          openedAt.current = Date.now();
          firstLoad.current = false;
        }

        setNextCursor(cursor);
        setTotal(lastResult.total);
        setSources(lastResult.sources);
        setError('');
        setDiscovering(!!lastResult.initializing);

        if (manual) {
          setSessions(rows);
          setHasPendingReorder(false);
        } else {
          setSessions((prev) => {
            if (prev.length === 0) {
              return rows;
            }
            const rowMap = new Map(rows.map((r) => [r.id, r]));
            const orderDiverged =
              rows.length !== prev.length ||
              rows.some((r, idx) => r.id !== prev[idx]?.id) ||
              rows.some((r) => !prev.some((p) => p.id === r.id));
            if (orderDiverged) {
              setHasPendingReorder(true);
            }
            return prev
              .filter((s) => {
                if (provider && s.provider !== provider) return false;
                if (filter && s.execution !== filter && s.attention !== filter) return false;
                const updated = rowMap.get(s.id);
                if (updated) return updated.archived === archive;
                if (!lastResult.nextCursor) return false;
                return true;
              })
              .map((s) => rowMap.get(s.id) ?? s);
          });
        }

        // Play alert tone if a new session needs approval or user input
        const waitingIds = new Set(
          rows
            .filter(
              (s) =>
                s.execution === 'WAITING_APPROVAL' ||
                s.execution === 'WAITING_INPUT',
            )
            .map((s) => s.id),
        );
        if (!firstLoad.current) {
          for (const id of waitingIds) {
            if (!prevWaiting.current.has(id)) {
              playSound('alert');
              break;
            }
          }
        }
        prevWaiting.current = waitingIds;
      } catch (e) {
        if (call === serial.current) setError((e as Error).message);
      } finally {
        if (manual) inFlightManual.current = false;
        if (call === serial.current) setLoading(false);
      }
    },
    [archive, provider, filter],
  );

  const loadMore = async () => {
    if (loadingMore) return;
    if (!nextCursor) {
      void refresh({ manual: true });
      return;
    }
    setLoadingMore(true);
    const targetArchive = archive;
    const targetProvider = provider;
    const targetFilter = filter;
    try {
      const query = new URLSearchParams({
        archive: String(targetArchive),
        pageSize: '12',
        cursor: nextCursor,
      });
      if (targetProvider) query.set('provider', targetProvider);
      if (targetFilter) query.set('state', targetFilter);
      const result = await request<SessionList & { error?: string }>('/api/sessions?' + query);
      if ('error' in result && result.error) throw new Error(String(result.error));

      if (archive !== targetArchive || provider !== targetProvider || filter !== targetFilter) {
        return;
      }

      setSessions((prev) => {
        const existingIds = new Set(prev.map((s) => s.id));
        const newSessions = result.sessions.filter((s) => !existingIds.has(s.id));
        return [...prev, ...newSessions];
      });
      setNextCursor(result.nextCursor);
      setTotal(result.total);
      pagesRef.current += 1;
      setPages(pagesRef.current);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const resetPagination = () => {
    pagesRef.current = 1;
    setPages(1);
    setNextCursor(null);
    setSessions([]);
    setLoading(true);
  };

  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    setLoading(true);
    void refresh({ manual: true });
    return () => {
      serial.current++;
    };
  }, [refresh]);

  useEffect(() => {
    if (!discovering) return;
    const pollTimer = setInterval(() => void refreshRef.current({ manual: false }), 1000);
    return () => clearInterval(pollTimer);
  }, [discovering]);

  useEffect(() => {
    const stream = new EventSource('/api/events');
    let timer: ReturnType<typeof setTimeout> | undefined;
    stream.onopen = () => {
      setConnected(true);
      void refreshRef.current({ manual: false });
    };
    stream.onerror = () => setConnected(false);
    stream.addEventListener('change', () => {
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          void refreshRef.current({ manual: false });
        }, 80);
    });
    return () => {
      stream.close();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <main className={styles.app}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            ▦
          </span>
          <div>
            <h1>{t.topbar.title}</h1>
            <p>{t.topbar.subtitle}</p>
          </div>
        </div>
        <div className={styles.topbarRight}>
          <div className={styles.connection} data-connected={connected}>
            <span />
            {connected ? t.topbar.connected : t.topbar.reconnecting}
          </div>
          <button
            className={styles.soundToggle}
            data-active={soundOn}
            onClick={toggleSound}
            title={soundOn ? t.topbar.soundOn : t.topbar.soundOff}
            aria-label="Sound effects toggle"
          >
            {soundOn ? '🔊' : '🔇'}
          </button>
          <ThemeSwitcher />
          <LanguageSwitcher />
        </div>
      </header>
      <section className={styles.toolbar} aria-label={t.toolbar.filterSessions}>
        <div className={styles.tabs}>
          <button
            className={!archive ? styles.selected : ''}
            onClick={() => {
              if (archive) {
                setArchive(false);
                resetPagination();
              }
            }}
          >
            {t.toolbar.activeBoard}
          </button>
          <button
            className={archive ? styles.selected : ''}
            onClick={() => {
              if (!archive) {
                setArchive(true);
                resetPagination();
              }
            }}
          >
            {t.toolbar.archivedHistory}
          </button>
        </div>
        <label>
          {t.toolbar.source}
          <select
            aria-label={t.toolbar.source}
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              resetPagination();
            }}
          >
            <option value="">{t.toolbar.allSources}</option>
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
            <option value="antigravity">Antigravity</option>
          </select>
        </label>
        <label>
          {t.toolbar.status}
          <select
            aria-label={t.toolbar.status}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              resetPagination();
            }}
          >
            <option value="">{t.toolbar.allStatuses}</option>
            <option value="RUNNING">{t.states.RUNNING}</option>
            <option value="WAITING_APPROVAL">{t.states.WAITING_APPROVAL}</option>
            <option value="WAITING_INPUT">{t.states.WAITING_INPUT}</option>
            <option value="UNREAD_COMPLETION">{t.states.UNREAD_COMPLETION}</option>
            <option value="UNREAD_OUTPUT">{t.states.UNREAD_OUTPUT}</option>
            <option value="READ">{t.states.READ}</option>
            <option value="BASELINE_EXISTING">{t.states.BASELINE_EXISTING}</option>
            <option value="UNKNOWN">{t.states.UNKNOWN}</option>
            <option value="FAILED">{t.states.FAILED}</option>
            <option value="IDLE">{t.states.IDLE}</option>
            <option value="COMPLETED">{t.states.COMPLETED}</option>
          </select>
        </label>
        <span className={styles.total}>{t.toolbar.totalSessions(total)}</span>
        <button
          className={`${styles.refreshBtn} ${hasPendingReorder ? styles.refreshBtnPending : ''}`}
          onClick={() => void refresh({ manual: true })}
          aria-label={t.toolbar.refreshTooltip}
          title={hasPendingReorder ? t.toolbar.refreshPendingTooltip : t.toolbar.refreshTooltip}
        >
          {t.toolbar.refresh}
          {hasPendingReorder && <span className={styles.pendingDot} />}
        </button>
      </section>
      {hasPendingReorder && (
        <button
          className={styles.reorderNotice}
          onClick={() => void refresh({ manual: true })}
        >
          <span className={styles.pendingDot} />
          {t.toolbar.reorderNotice}
        </button>
      )}
      <div className={styles.boardHeading}>
        <h2>{archive ? t.board.headingArchived : t.board.headingActive}</h2>
        <div className={styles.boardHeadingRight}>
          {!archive && (
            <div className={styles.newSessionGroup} role="group" aria-label={t.newSession.modalTitle}>
              <button
                type="button"
                className={`${styles.newSessionBtn} ${styles.newSessionCodex}`}
                onClick={() => handleOpenNewSession('codex')}
                title={t.newSession.btnCodex}
              >
                <AgentLogo provider="codex" size={13} />
                <span>{t.newSession.btnCodex}</span>
              </button>
              <button
                type="button"
                className={`${styles.newSessionBtn} ${styles.newSessionClaude}`}
                onClick={() => handleOpenNewSession('claude')}
                title={t.newSession.btnClaude}
              >
                <AgentLogo provider="claude" size={13} />
                <span>{t.newSession.btnClaude}</span>
              </button>
              <button
                type="button"
                className={`${styles.newSessionBtn} ${styles.newSessionAntigravity}`}
                onClick={() => handleOpenNewSession('antigravity')}
                title={t.newSession.btnAntigravity}
              >
                <AgentLogo provider="antigravity" size={13} />
                <span>{t.newSession.btnAntigravity}</span>
              </button>
            </div>
          )}
          <span className={styles.boardSubheading}>{t.board.subheading}</span>
        </div>
      </div>
      {sources
        .filter((s) => !s.available || s.message)
        .map((s, i) => (
          <div key={s.provider + i} className={styles.sourceNotice}>
            {s.provider === 'codex'
              ? 'Codex'
              : s.provider === 'antigravity'
                ? 'Antigravity'
                : 'Claude'}：{s.message}
          </div>
        ))}
      {error && (
        <div className={styles.error} role="alert">
          {error} <button onClick={() => void refresh({ manual: true })}>{t.common.retry}</button>
        </div>
      )}
      {(loading || discovering) && !sessions.length ? (
        <div className={styles.empty}>{t.board.discovering}</div>
      ) : !sessions.length && !error ? (
        <div className={styles.empty}>
          <h3>{archive ? t.board.emptyArchivedTitle : t.board.emptyFilteredTitle}</h3>
          <p>{t.board.emptyDescription}</p>
        </div>
      ) : null}
      <section className={styles.grid} aria-label={t.board.cardsGrid}>
        {sessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            newlyDiscovered={session.discoveredAt > openedAt.current && !discovering}
            autoExpand={session.id === autoExpandId}
            initialPrompt={newSessionPrompts[session.id]}
            onExpandChange={(expanded) => {
              if (expanded && session.cwd) {
                setLastActiveCwd(session.cwd);
              }
              if (!expanded && autoExpandId === session.id) {
                setAutoExpandId(null);
              }
            }}
            onChange={(action) =>
              refresh({ manual: action === 'archive' || action === 'unarchive' })
            }
          />
        ))}
      </section>
      {sessions.length < total && (
        <div className={styles.more}>
          <button onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? t.common.loading : t.board.loadMore}
          </button>
          <span>{t.board.remainingSessions(total - sessions.length)}</span>
        </div>
      )}
      <footer className={styles.pageFooter}>{t.board.pageFooter}</footer>
      <NewSessionModal
        isOpen={newModalOpen}
        initialProvider={newModalProvider}
        currentSessionCwd={
          (autoExpandId && sessions.find((s) => s.id === autoExpandId)?.cwd) ||
          lastActiveCwd ||
          sessions[0]?.cwd
        }
        allSessions={sessions}
        onClose={() => setNewModalOpen(false)}
        onSuccess={handleNewSessionSuccess}
      />
    </main>
  );
}

export function App() {
  return (
    <I18nProvider>
      <BoardApp />
    </I18nProvider>
  );
}
