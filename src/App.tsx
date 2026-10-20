import { useCallback, useEffect, useRef, useState } from 'react';
import type { Provider, SessionList, SessionView } from '../shared/types.js';
import { getRemoteToken, request, saveLanOrigin, withRemoteAuthUrl } from './api.js';
import { SessionCard } from './SessionCard.js';
import { AgentLogo } from './AgentLogo.js';
import { NewSessionModal } from './NewSessionModal.js';
import { RemoteControlModal } from './RemoteControlModal.js';
import { PwaInstallModal } from './PwaInstallModal.js';
import { ThemeSwitcher } from './ThemeSwitcher.js';
import { I18nProvider, LanguageSwitcher, useI18n } from './i18n/index.js';
import { isSoundEnabled, setSoundEnabled, playSound } from './sound.js';
import {
  isPushEnabled,
  enablePushNotifications,
  disablePushNotifications,
  syncPushSubscriptionIfEnabled,
  triggerClientWaitingNotification,
} from './push.js';
import styles from './Board.module.css';

function isRunningStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return (
      window.matchMedia(
        '(display-mode: standalone), (display-mode: window-controls-overlay), (display-mode: minimal-ui)',
      ).matches || (window.navigator as any).standalone === true
    );
  } catch {
    return false;
  }
}

function BoardApp() {
  const { t, tr, locale } = useI18n();
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
  const [pushOn, setPushOn] = useState(() => isPushEnabled());
  const prevWaiting = useRef(new Set<string>());

  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newModalProvider, setNewModalProvider] = useState<Provider>('antigravity');
  const [autoExpandId, setAutoExpandId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return new URLSearchParams(window.location.search).get('session');
    } catch {
      return null;
    }
  });
  const autoExpandRef = useRef<string | null>(autoExpandId);
  autoExpandRef.current = autoExpandId;
  const [remoteModalOpen, setRemoteModalOpen] = useState(false);
  const [remoteTargetSession, setRemoteTargetSession] = useState<SessionView | null>(null);
  const [pwaModalOpen, setPwaModalOpen] = useState(false);
  const [deferredPwaPrompt, setDeferredPwaPrompt] = useState<any>(null);
  const [isStartingHttps, setIsStartingHttps] = useState(false);
  const [pwaInstallError, setPwaInstallError] = useState('');
  const [showPwaBanner, setShowPwaBanner] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      if (isRunningStandalonePwa()) return false;
      if (localStorage.getItem('agent_board_pwa_dismissed_v2') === '1') return false;
      const isRemoteHost =
        window.location.hostname !== '127.0.0.1' && window.location.hostname !== 'localhost';
      const isMobileScreen = window.matchMedia('(max-width: 768px)').matches;
      return isRemoteHost || isMobileScreen;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPwaPrompt(e);
      if (!isRunningStandalonePwa() && localStorage.getItem('agent_board_pwa_dismissed_v2') !== '1') {
        setShowPwaBanner(true);
      }
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  // Only open the 1-click confirmation sheet automatically when redirected via ?autoInstall=1
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('autoInstall') === '1') {
        url.searchParams.delete('autoInstall');
        window.history.replaceState(null, '', url.toString());
        if (!isRunningStandalonePwa()) {
          setPwaModalOpen(true);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    const desktopApi = (window as any).agentBoardDesktop;
    if (desktopApi && typeof desktopApi.onOpenRemoteControl === 'function') {
      return desktopApi.onOpenRemoteControl(() => {
        setRemoteTargetSession(null);
        setRemoteModalOpen(true);
      });
    }
  }, []);

  const [updateState, setUpdateState] = useState<{
    status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
    currentVersion: string;
    latestVersion: string | null;
    releaseUrl: string;
    downloadUrl: string | null;
    progressPercent: number | null;
    error: string | null;
  }>({
    status: 'idle',
    currentVersion: '0.1.2',
    latestVersion: null,
    releaseUrl: 'https://github.com/Useless-Lab-AI/agent-board/releases/latest',
    downloadUrl: null,
    progressPercent: null,
    error: null,
  });
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [showUpToDateToast, setShowUpToDateToast] = useState(false);

  useEffect(() => {
    const desktopApi = (window as any).agentBoardDesktop;
    if (desktopApi && typeof desktopApi.getUpdateState === 'function') {
      void desktopApi.getUpdateState().then((st: any) => {
        if (st && typeof st.currentVersion === 'string') {
          setUpdateState(st);
        }
      });
      if (typeof desktopApi.onUpdateState === 'function') {
        return desktopApi.onUpdateState((st: any) => {
          if (st && typeof st.currentVersion === 'string') {
            setUpdateState(st);
            if (st.status === 'available' || st.status === 'downloading' || st.status === 'downloaded') {
              setUpdateDismissed(false);
            }
          }
        });
      }
      return;
    }

    // Web / CLI server fallback: check version once after mount
    let cancelled = false;
    const checkWebVersion = async () => {
      try {
        const res = await request<{
          currentVersion: string;
          latestVersion: string | null;
          hasUpdate: boolean;
          releaseUrl: string;
          downloadUrl: string | null;
        }>('/api/system/version?check=1');
        if (cancelled || !res) return;
        setUpdateState({
          status: res.hasUpdate ? 'available' : 'not-available',
          currentVersion: res.currentVersion || '0.1.2',
          latestVersion: res.latestVersion,
          releaseUrl: res.releaseUrl || 'https://github.com/Useless-Lab-AI/agent-board/releases/latest',
          downloadUrl: res.downloadUrl,
          progressPercent: null,
          error: null,
        });
      } catch {}
    };
    const timer = setTimeout(() => void checkWebVersion(), 4000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const handleManualCheckUpdate = async () => {
    playSound('click');
    setUpdateDismissed(false);
    setUpdateState((prev) => ({ ...prev, status: 'checking', error: null }));
    const desktopApi = (window as any).agentBoardDesktop;
    if (desktopApi && typeof desktopApi.checkForUpdates === 'function') {
      try {
        const next = await desktopApi.checkForUpdates(true);
        if (next && typeof next.currentVersion === 'string') {
          setUpdateState(next);
        }
        if (next?.status === 'not-available') {
          setShowUpToDateToast(true);
          setTimeout(() => setShowUpToDateToast(false), 3500);
        }
      } catch (err) {
        setUpdateState((prev) => ({
          ...prev,
          status: 'error',
          error: (err as Error).message,
        }));
      }
      return;
    }
    try {
      const res = await request<{
        currentVersion: string;
        latestVersion: string | null;
        hasUpdate: boolean;
        releaseUrl: string;
        downloadUrl: string | null;
        error?: string;
      }>('/api/system/version?check=1');
      if (res.error) {
        setUpdateState((prev) => ({ ...prev, status: 'error', error: res.error || null }));
      } else if (res.hasUpdate) {
        setUpdateState({
          status: 'available',
          currentVersion: res.currentVersion,
          latestVersion: res.latestVersion,
          releaseUrl: res.releaseUrl,
          downloadUrl: res.downloadUrl,
          progressPercent: null,
          error: null,
        });
      } else {
        setUpdateState((prev) => ({
          ...prev,
          status: 'not-available',
          currentVersion: res.currentVersion || prev.currentVersion,
          latestVersion: res.latestVersion,
        }));
        setShowUpToDateToast(true);
        setTimeout(() => setShowUpToDateToast(false), 3500);
      }
    } catch (err) {
      setUpdateState((prev) => ({
        ...prev,
        status: 'error',
        error: (err as Error).message,
      }));
    }
  };

  const handleStartUpdate = async () => {
    playSound('click');
    setUpdateDismissed(false);
    setUpdateState((prev) => ({
      ...prev,
      status: 'downloading',
      progressPercent: prev.progressPercent ?? 0,
      error: null,
    }));

    const desktopApi = (window as any).agentBoardDesktop;
    if (desktopApi && typeof desktopApi.startUpdate === 'function') {
      try {
        const next = await desktopApi.startUpdate();
        if (next && typeof next.currentVersion === 'string') {
          setUpdateState(next);
        }
      } catch (err) {
        setUpdateState((prev) => ({
          ...prev,
          status: 'error',
          error: (err as Error).message,
        }));
      }
      return;
    }

    try {
      const startRes = await request<{
        status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
        currentVersion: string;
        latestVersion: string | null;
        releaseUrl: string;
        downloadUrl: string | null;
        progressPercent: number | null;
        error: string | null;
        fallbackBrowser?: boolean;
      }>('/api/system/update', { action: 'start' });

      if (startRes?.fallbackBrowser) {
        const targetUrl = startRes.downloadUrl || updateState.downloadUrl || updateState.releaseUrl;
        setUpdateState((prev) => ({ ...prev, status: 'available', progressPercent: null }));
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
        return;
      }

      if (startRes && typeof startRes.currentVersion === 'string') {
        setUpdateState(startRes);
      }

      const poll = async () => {
        for (let i = 0; i < 600; i++) {
          await new Promise((r) => setTimeout(r, 400));
          const st = await request<{
            status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
            currentVersion: string;
            latestVersion: string | null;
            releaseUrl: string;
            downloadUrl: string | null;
            progressPercent: number | null;
            error: string | null;
          }>('/api/system/update');
          if (!st || typeof st.currentVersion !== 'string') break;
          setUpdateState(st);
          if (st.status !== 'downloading') break;
        }
      };
      void poll();
    } catch {
      const targetUrl = updateState.downloadUrl || updateState.releaseUrl;
      setUpdateState((prev) => ({ ...prev, status: 'available', progressPercent: null }));
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleInstallUpdate = async () => {
    playSound('click');
    const desktopApi = (window as any).agentBoardDesktop;
    if (desktopApi && typeof desktopApi.installUpdate === 'function') {
      await desktopApi.installUpdate();
      return;
    }
    try {
      const res = await request<{ ok?: boolean; fallbackBrowser?: boolean }>('/api/system/update', {
        action: 'install',
      });
      if (!res?.fallbackBrowser) return;
    } catch {}
    const targetUrl = updateState.downloadUrl || updateState.releaseUrl;
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  const handleOpenExternalUrl = (url: string) => {
    const desktopApi = (window as any).agentBoardDesktop;
    if (desktopApi && typeof desktopApi.openExternal === 'function') {
      void desktopApi.openExternal(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

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

  useEffect(() => {
    void syncPushSubscriptionIfEnabled(locale);
  }, [locale]);

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
          else if (autoExpandRef.current) query.set('pin', autoExpandRef.current);
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

        // Play alert tone and trigger notification if a new session needs approval or user input
        const waitingSessions = rows.filter(
          (s) =>
            !s.archived &&
            (s.execution === 'WAITING_APPROVAL' || s.execution === 'WAITING_INPUT'),
        );
        const waitingIds = new Set(waitingSessions.map((s) => s.id));
        if (!firstLoad.current) {
          let playedAlert = false;
          for (const ws of waitingSessions) {
            if (!prevWaiting.current.has(ws.id)) {
              if (!playedAlert) {
                playSound('alert');
                playedAlert = true;
              }
              const isApproval = ws.execution === 'WAITING_APPROVAL';
              const notifTitle = `${isApproval ? '⚠️' : '💬'} ${t.states[ws.execution]} · ${ws.title}`;
              const notifBody = tr(ws.stateReason);
              triggerClientWaitingNotification(ws, notifTitle, notifBody, (targetId) => {
                autoExpandRef.current = targetId;
                setAutoExpandId(targetId);
                void refresh({ manual: true });
              });
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
    [archive, provider, filter, t.states, tr],
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data && data.type === 'agent-board:open-session' && typeof data.sessionId === 'string') {
        const targetId = data.sessionId;
        autoExpandRef.current = targetId;
        setAutoExpandId(targetId);
        try {
          const u = new URL(window.location.href);
          u.searchParams.set('session', targetId);
          window.history.replaceState({ agentBoardSession: targetId }, '', u.toString());
        } catch {}
        void refresh({ manual: true });
      }
    };
    navigator.serviceWorker.addEventListener('message', handleMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
  }, [refresh]);

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
    const stream = new EventSource(withRemoteAuthUrl('/api/events'));
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

  const handleDismissPwaBanner = () => {
    setShowPwaBanner(false);
    try {
      localStorage.setItem('agent_board_pwa_dismissed_v2', '1');
    } catch {}
  };

  const handleTriggerNativeInstall = async (): Promise<boolean> => {
    if (deferredPwaPrompt && typeof deferredPwaPrompt.prompt === 'function') {
      try {
        await deferredPwaPrompt.prompt();
        setDeferredPwaPrompt(null);
        setShowPwaBanner(false);
        setPwaModalOpen(false);
        return true;
      } catch {}
    }
    return false;
  };

  const handleStartHttpsInstall = async () => {
    if (isStartingHttps) return;
    setIsStartingHttps(true);
    setPwaInstallError('');
    playSound('click');
    try {
      let res = await request<{
        tunnel: { status: string; url: string | null; error: string | null };
        token?: string;
        primaryLanUrl?: string | null;
        customUrl?: string | null;
      }>('/api/remote-control', {
        action: 'startTunnel',
      });
      const deadline = Date.now() + 14000;
      while (res.tunnel.status === 'starting' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 700));
        res = await request('/api/remote-control');
      }
      if (res.tunnel.status === 'running' && res.tunnel.url) {
        const lanOrigin =
          res.customUrl || res.primaryLanUrl || window.location.origin;
        saveLanOrigin(lanOrigin);
        const target = new URL(res.tunnel.url);
        const currentParams = new URLSearchParams(window.location.search);
        const rc = getRemoteToken() || currentParams.get('rc') || res.token || '';
        if (rc) target.searchParams.set('rc', rc);
        const sessionParam = currentParams.get('session');
        if (sessionParam) target.searchParams.set('session', sessionParam);
        if (lanOrigin) target.searchParams.set('lan', lanOrigin);
        target.searchParams.set('autoInstall', '1');
        window.location.href = target.toString();
        return;
      }
      throw new Error(res.tunnel.error || '无法开启 HTTPS 安全安装通道');
    } catch (err) {
      setPwaInstallError((err as Error).message || '开启 HTTPS 通道失败');
      setPwaModalOpen(true);
    } finally {
      setIsStartingHttps(false);
    }
  };

  const handleInstallPwa = async () => {
    playSound('click');
    if (await handleTriggerNativeInstall()) {
      return;
    }
    if (typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent || '')) {
      window.location.href = withRemoteAuthUrl('/api/pwa/install.mobileconfig');
      return;
    }
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      await handleStartHttpsInstall();
      return;
    }
    setPwaModalOpen(true);
  };

  const togglePush = async () => {
    if (pushOn) {
      playSound('click');
      setPushOn(false);
      await disablePushNotifications();
      return;
    }
    playSound('click');
    const res = await enablePushNotifications(locale);
    if (res.ok) {
      setPushOn(true);
      playSound('approve');
      if (res.mode === 'web-push') {
        void request('/api/push/test', { lang: locale }).catch(() => {});
      }
      return;
    }
    if (res.reason === 'ios-pwa-required') {
      setPwaInstallError(
        locale === 'en-US'
          ? 'iOS requires installing Agent Board to your Home Screen first to enable lock-screen push notifications.'
          : locale === 'ja-JP'
            ? 'iOSでプッシュ通知を受け取るには、まずホーム画面にアプリを追加してください。'
            : locale === 'zh-TW'
              ? 'iOS 系統要求先將 Agent Board 添加到主畫面（桌面應用），才能開啟鎖屏推送通知。'
              : 'iOS 系统要求先将 Agent Board 添加到手机桌面应用，才能开启锁屏推送通知。',
      );
      setPwaModalOpen(true);
      return;
    }
    if (res.reason === 'insecure-context') {
      await handleStartHttpsInstall();
      return;
    }
    if (res.reason === 'denied') {
      setError(
        locale === 'en-US'
          ? 'Notification permission was denied by the browser. Please allow notifications in site settings.'
          : locale === 'ja-JP'
            ? 'ブラウザで通知権限が拒否されました。サイト設定で通知を許可してください。'
            : locale === 'zh-TW'
              ? '瀏覽器已拒絕通知權限，請在瀏覽器網站設定中允許通知。'
              : '浏览器已拒绝通知权限，请在浏览器网站设置中允许通知。',
      );
    }
  };

  return (
    <main className={styles.app}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <img
            src={withRemoteAuthUrl('/icon.svg')}
            alt=""
            className={styles.brandLogo}
            aria-hidden="true"
          />
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
            type="button"
            className={`${styles.versionChip} ${
              updateState.status === 'available' ||
              updateState.status === 'downloading' ||
              updateState.status === 'downloaded'
                ? styles.versionChipUpdate
                : ''
            }`}
            onClick={() => {
              if (updateState.status === 'available') {
                void handleStartUpdate();
              } else if (updateState.status === 'downloaded') {
                void handleInstallUpdate();
              } else if (
                updateState.status === 'downloading' ||
                updateState.status === 'checking'
              ) {
                setUpdateDismissed(false);
              } else {
                void handleManualCheckUpdate();
              }
            }}
            title={
              updateState.status === 'available'
                ? t.updater.updateNowBtn
                : updateState.status === 'downloaded'
                  ? t.updater.restartInstallBtn
                  : updateState.status === 'downloading'
                    ? t.updater.downloadingTitle(
                        updateState.latestVersion || '',
                        updateState.progressPercent ?? 0,
                      )
                    : t.updater.checkBtn
            }
            aria-label={
              updateState.status === 'available'
                ? t.updater.updateNowBtn
                : updateState.status === 'downloaded'
                  ? t.updater.restartInstallBtn
                  : updateState.status === 'downloading'
                    ? t.updater.downloadingTitle(
                        updateState.latestVersion || '',
                        updateState.progressPercent ?? 0,
                      )
                    : t.updater.checkBtn
            }
          >
            {updateState.status === 'checking'
              ? t.updater.checking
              : updateState.status === 'downloading'
                ? t.updater.downloadingTitle(
                    updateState.latestVersion || '',
                    updateState.progressPercent ?? 0,
                  )
                : updateState.status === 'downloaded'
                  ? t.updater.restartInstallBtn
                  : updateState.status === 'available'
                    ? t.updater.availableBadge(updateState.latestVersion || '')
                    : showUpToDateToast
                      ? t.updater.upToDate(updateState.currentVersion)
                      : `v${updateState.currentVersion}`}
          </button>
          <button
            type="button"
            className={styles.remoteTopbarBtn}
            onClick={() => {
              playSound('click');
              setRemoteTargetSession(null);
              setRemoteModalOpen(true);
            }}
            title={t.topbar.remoteControlTooltip}
            aria-label={t.topbar.remoteControl}
          >
            <span aria-hidden="true">📱</span>
            <span>{t.topbar.remoteControl}</span>
          </button>
          <button
            type="button"
            className={styles.soundToggle}
            data-active={pushOn}
            onClick={() => void togglePush()}
            title={pushOn ? t.topbar.pushOn : t.topbar.pushOff}
            aria-label={pushOn ? t.topbar.pushOn : t.topbar.pushOff}
          >
            {pushOn ? '🔔' : '🔕'}
          </button>
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
      {!updateDismissed &&
        (updateState.status === 'available' ||
          updateState.status === 'downloading' ||
          updateState.status === 'downloaded' ||
          updateState.status === 'error') && (
          <div className={styles.updateBanner} role="status">
            <div className={styles.updateBannerRow}>
              <div className={styles.updateBannerTitle}>
                {updateState.status === 'available' &&
                  t.updater.bannerTitle(
                    updateState.latestVersion || '',
                    updateState.currentVersion,
                  )}
                {updateState.status === 'downloading' &&
                  t.updater.downloadingTitle(
                    updateState.latestVersion || '',
                    updateState.progressPercent ?? 0,
                  )}
                {updateState.status === 'downloaded' &&
                  t.updater.downloadedTitle(updateState.latestVersion || '')}
                {updateState.status === 'error' &&
                  t.updater.errorTitle(updateState.error || '')}
              </div>
              <div className={styles.updateBannerActions}>
                {updateState.status === 'available' && (
                  <>
                    <button
                      type="button"
                      className={styles.updatePrimaryBtn}
                      onClick={() => void handleStartUpdate()}
                    >
                      {t.updater.updateNowBtn}
                    </button>
                    <button
                      type="button"
                      className={styles.updateSecondaryBtn}
                      onClick={() => handleOpenExternalUrl(updateState.releaseUrl)}
                    >
                      {t.updater.releaseNotesBtn}
                    </button>
                    <button
                      type="button"
                      className={styles.updateSecondaryBtn}
                      onClick={() => setUpdateDismissed(true)}
                      title={t.updater.dismissBtn}
                    >
                      ✕
                    </button>
                  </>
                )}
                {updateState.status === 'downloaded' && (
                  <button
                    type="button"
                    className={styles.updatePrimaryBtn}
                    onClick={() => void handleInstallUpdate()}
                  >
                    {t.updater.restartInstallBtn}
                  </button>
                )}
                {updateState.status === 'error' && (
                  <>
                    <button
                      type="button"
                      className={styles.updatePrimaryBtn}
                      onClick={() =>
                        handleOpenExternalUrl(updateState.downloadUrl || updateState.releaseUrl)
                      }
                    >
                      {t.updater.downloadManualBtn}
                    </button>
                    <button
                      type="button"
                      className={styles.updateSecondaryBtn}
                      onClick={() => setUpdateDismissed(true)}
                      title={t.updater.dismissBtn}
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            </div>
            {updateState.status === 'downloading' && (
              <div className={styles.updateProgressTrack}>
                <div
                  className={styles.updateProgressFill}
                  style={{ width: `${Math.max(4, updateState.progressPercent ?? 0)}%` }}
                />
              </div>
            )}
          </div>
        )}
      {showPwaBanner && (
        <div className={styles.pwaBanner} role="region" aria-label={t.remoteControl.pwaBannerTitle}>
          <div
            className={styles.pwaBannerText}
            onClick={() => void handleInstallPwa()}
            style={{ cursor: 'pointer' }}
          >
            <strong>📲 {t.remoteControl.pwaBannerTitle}</strong>
            <span>{t.remoteControl.pwaBannerDesc}</span>
          </div>
          <div className={styles.pwaBannerActions}>
            <button
              type="button"
              className={styles.pwaBannerInstall}
              disabled={isStartingHttps}
              onClick={() => void handleInstallPwa()}
            >
              {isStartingHttps ? '⏳ 正在准备…' : `📲 ${t.remoteControl.pwaBannerInstallBtn}`}
            </button>
            <button
              type="button"
              className={styles.pwaBannerDismiss}
              onClick={handleDismissPwaBanner}
              aria-label={t.remoteControl.pwaBannerDismiss}
              title={t.remoteControl.pwaBannerDismiss}
            >
              ✕
            </button>
          </div>
        </div>
      )}
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
            onOpenRemote={(s) => {
              setRemoteTargetSession(s);
              setRemoteModalOpen(true);
            }}
            onExpandChange={(expanded) => {
              if (!expanded && autoExpandId === session.id) {
                setAutoExpandId(null);
                try {
                  const u = new URL(window.location.href);
                  if (u.searchParams.get('session') === session.id) {
                    u.searchParams.delete('session');
                    window.history.replaceState(null, '', u.toString());
                  }
                } catch {}
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
        allSessions={sessions}
        onClose={() => setNewModalOpen(false)}
        onSuccess={handleNewSessionSuccess}
      />
      <RemoteControlModal
        isOpen={remoteModalOpen}
        sessionId={remoteTargetSession?.id}
        sessionTitle={remoteTargetSession ? tr(remoteTargetSession.title) : undefined}
        onOpenPwaInstall={() => {
          setRemoteModalOpen(false);
          void handleInstallPwa();
        }}
        onClose={() => {
          setRemoteModalOpen(false);
          setRemoteTargetSession(null);
        }}
      />
      <PwaInstallModal
        isOpen={pwaModalOpen}
        hasNativePrompt={!!deferredPwaPrompt}
        isStartingHttps={isStartingHttps}
        installError={pwaInstallError}
        onTriggerNativeInstall={handleTriggerNativeInstall}
        onStartHttpsInstall={handleStartHttpsInstall}
        onClose={() => {
          setPwaModalOpen(false);
        }}
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
