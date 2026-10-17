import { useEffect, useMemo, useRef, useState } from 'react';
import { request, withRemoteAuthUrl } from './api.js';
import { QrCode } from './QrCode.js';
import { useI18n } from './i18n/index.js';
import { playSound } from './sound.js';
import styles from './Board.module.css';

export interface LanEndpoint {
  name: string;
  address: string;
  url: string;
  kind: 'lan' | 'tailscale' | 'virtual';
}

export interface TunnelState {
  status: 'stopped' | 'starting' | 'running' | 'error';
  url: string | null;
  provider: 'cloudflared' | 'localhost.run' | null;
  error: string | null;
}

export interface RemoteControlStatus {
  enabled: boolean;
  isRemoteClient: boolean;
  deviceName: string;
  port: number;
  lanEndpoints: LanEndpoint[];
  primaryLanUrl: string;
  customUrl: string;
  tunnel: TunnelState;
  token?: string;
}

type ConnectionMode = 'lan' | 'tunnel' | 'custom';

export function RemoteControlModal({
  isOpen,
  sessionId,
  sessionTitle,
  onClose,
}: {
  isOpen: boolean;
  sessionId?: string;
  sessionTitle?: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<RemoteControlStatus | null>(null);
  const [mode, setMode] = useState<ConnectionMode>('lan');
  const [selectedLanUrl, setSelectedLanUrl] = useState<string>('');
  const [deviceNameInput, setDeviceNameInput] = useState('');
  const [customUrlInput, setCustomUrlInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [savedDevice, setSavedDevice] = useState(false);
  const [rotatedNotice, setRotatedNotice] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadStatus = async () => {
    try {
      const res = await request<RemoteControlStatus>('/api/remote-control');
      setStatus(res);
      setDeviceNameInput((prev) => (prev ? prev : res.deviceName));
      setCustomUrlInput((prev) => (prev ? prev : res.customUrl));
      if (!selectedLanUrl && res.primaryLanUrl) {
        setSelectedLanUrl(res.primaryLanUrl);
      }
      if (res.tunnel.status === 'running' && res.tunnel.url && mode === 'lan' && !selectedLanUrl) {
        setMode('tunnel');
      }
    } catch {}
  };

  useEffect(() => {
    if (!isOpen) return;
    void loadStatus();
    const stream = new EventSource(withRemoteAuthUrl('/api/events'));
    stream.addEventListener('remote_control', () => {
      void loadStatus();
    });
    return () => {
      stream.close();
    };
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Fallback for browsers that do not yet support closedby="any" on <dialog>
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !isOpen) return;
    if ('closedBy' in HTMLDialogElement.prototype) return;
    const handleClick = (event: MouseEvent) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const clickedOutside =
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom;
      if (clickedOutside) {
        dialog.close();
      }
    };
    dialog.addEventListener('click', handleClick);
    return () => dialog.removeEventListener('click', handleClick);
  }, [isOpen]);

  const baseUrl = useMemo(() => {
    if (!status) return window.location.origin;
    if (mode === 'tunnel' && status.tunnel.url) {
      return status.tunnel.url;
    }
    if (mode === 'custom' && customUrlInput.trim()) {
      return customUrlInput.trim().replace(/\/+$/, '');
    }
    return selectedLanUrl || status.primaryLanUrl || window.location.origin;
  }, [status, mode, selectedLanUrl, customUrlInput]);

  const pairingUrl = useMemo(() => {
    try {
      const u = new URL(baseUrl);
      if (status?.token) {
        u.searchParams.set('rc', status.token);
      } else {
        const currentRc = new URLSearchParams(window.location.search).get('rc');
        if (currentRc) u.searchParams.set('rc', currentRc);
      }
      if (sessionId) {
        u.searchParams.set('session', sessionId);
      }
      return u.toString();
    } catch {
      return baseUrl;
    }
  }, [baseUrl, status?.token, sessionId]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(pairingUrl);
      playSound('click');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleToggleEnabled = async (nextEnabled: boolean) => {
    if (!status || status.isRemoteClient || busy) return;
    setBusy(true);
    try {
      const updated = await request<RemoteControlStatus>('/api/remote-control', {
        enabled: nextEnabled,
      });
      setStatus(updated);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveDeviceName = async () => {
    if (!status || status.isRemoteClient || busy) return;
    setBusy(true);
    try {
      const updated = await request<RemoteControlStatus>('/api/remote-control', {
        deviceName: deviceNameInput,
      });
      setStatus(updated);
      setDeviceNameInput(updated.deviceName);
      setSavedDevice(true);
      setTimeout(() => setSavedDevice(false), 2000);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveCustomUrl = async (val: string) => {
    setCustomUrlInput(val);
    if (!status || status.isRemoteClient) return;
    try {
      const updated = await request<RemoteControlStatus>('/api/remote-control', {
        customUrl: val,
      });
      setStatus(updated);
    } catch {}
  };

  const handleStartTunnel = async () => {
    if (!status || status.isRemoteClient || busy) return;
    setBusy(true);
    playSound('click');
    try {
      const updated = await request<RemoteControlStatus>('/api/remote-control', {
        action: 'startTunnel',
      });
      setStatus(updated);
    } finally {
      setBusy(false);
    }
  };

  const handleStopTunnel = async () => {
    if (!status || status.isRemoteClient || busy) return;
    setBusy(true);
    try {
      const updated = await request<RemoteControlStatus>('/api/remote-control', {
        action: 'stopTunnel',
      });
      setStatus(updated);
    } finally {
      setBusy(false);
    }
  };

  const handleRotateToken = async () => {
    if (!status || status.isRemoteClient || busy) return;
    if (!window.confirm(t.remoteControl.rotateTokenConfirm)) return;
    setBusy(true);
    try {
      const updated = await request<RemoteControlStatus>('/api/remote-control', {
        action: 'rotateToken',
      });
      setStatus(updated);
      setRotatedNotice(true);
      setTimeout(() => setRotatedNotice(false), 2200);
    } finally {
      setBusy(false);
    }
  };

  const isTunnelReady = mode === 'tunnel' && status?.tunnel.status === 'running' && !!status.tunnel.url;
  const showQr =
    (status?.enabled ?? true) &&
    (mode !== 'tunnel' || isTunnelReady);

  return (
    <dialog
      ref={dialogRef}
      closedby="any"
      className={`${styles.dialog} ${styles.remoteModal}`}
      onCancel={onClose}
      onClose={onClose}
      aria-label={
        sessionId ? t.remoteControl.sessionModalTitle : t.remoteControl.modalTitle
      }
    >
      {isOpen && (
        <div className={styles.remoteModalContainer}>
          <header className={styles.remoteModalHeader}>
            <div className={styles.remoteModalTitleGroup}>
              <span className={styles.remoteModalIcon} aria-hidden="true">
                📱
              </span>
              <div>
                <h3>
                  {sessionId
                    ? t.remoteControl.sessionModalTitle
                    : t.remoteControl.modalTitle}
                </h3>
                <p>
                  {sessionId && sessionTitle
                    ? t.remoteControl.sessionModalSubtitle(sessionTitle)
                    : t.remoteControl.modalSubtitle}
                </p>
              </div>
            </div>
            <button
              type="button"
              className={styles.iconButton}
              onClick={onClose}
              aria-label={t.remoteControl.close}
            >
              ✕
            </button>
          </header>

          <div className={styles.remoteModalBody}>
            {status?.isRemoteClient && (
              <div className={styles.remoteLockedBanner}>
                🔒 {t.remoteControl.remoteLockedNotice}
              </div>
            )}

            {/* Mode Switcher Tabs */}
            <div className={styles.remoteModeTabs} role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'lan'}
                className={mode === 'lan' ? styles.remoteModeTabActive : styles.remoteModeTab}
                onClick={() => setMode('lan')}
              >
                📶 {t.remoteControl.modeLan}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'tunnel'}
                className={mode === 'tunnel' ? styles.remoteModeTabActive : styles.remoteModeTab}
                onClick={() => setMode('tunnel')}
              >
                🌐 {t.remoteControl.modeTunnel}
                {status?.tunnel.status === 'running' && (
                  <span className={styles.remoteLiveDot} />
                )}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'custom'}
                className={mode === 'custom' ? styles.remoteModeTabActive : styles.remoteModeTab}
                onClick={() => setMode('custom')}
              >
                🔗 {t.remoteControl.modeCustom}
              </button>
            </div>

            {/* Antigravity-style Centered QR Card */}
            <div className={styles.remoteQrStage}>
              {showQr ? (
                <div className={styles.remoteQrCard}>
                  <QrCode
                    value={pairingUrl}
                    size={196}
                    moduleRounding={0.35}
                    className={styles.remoteQrSvg}
                  />
                  <div className={styles.remoteQrDeviceBadge}>
                    <span>💻 {status?.deviceName || 'Agent Board'}</span>
                    {sessionId && sessionTitle && (
                      <span className={styles.remoteQrSessionPill}>
                        {sessionTitle}
                      </span>
                    )}
                  </div>
                </div>
              ) : mode === 'tunnel' ? (
                <div className={styles.remoteTunnelPlaceholder}>
                  {status?.tunnel.status === 'starting' ? (
                    <>
                      <span className={styles.attachmentSpinner} />
                      <p>{t.remoteControl.tunnelStarting}</p>
                    </>
                  ) : (
                    <>
                      <p className={styles.remoteModeHint}>{t.remoteControl.tunnelHint}</p>
                      {status?.tunnel.error && (
                        <p className={styles.remoteTunnelError}>
                          {t.remoteControl.tunnelErrorPrefix}
                          {status.tunnel.error}
                        </p>
                      )}
                      {!status?.isRemoteClient && (
                        <button
                          type="button"
                          className={styles.newSessionSubmitBtn}
                          disabled={busy}
                          onClick={() => void handleStartTunnel()}
                        >
                          {t.remoteControl.tunnelStartBtn}
                        </button>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className={styles.remoteTunnelPlaceholder}>
                  <p className={styles.remoteModeHint}>{t.remoteControl.enableDesc}</p>
                </div>
              )}
            </div>

            {/* Mode-specific Controls */}
            {mode === 'lan' && status && status.lanEndpoints.length > 0 && (
              <div className={styles.remoteControlSection}>
                {status.lanEndpoints.length > 1 && (
                  <label className={styles.remoteFieldLabel}>
                    <span>{t.remoteControl.lanInterfaceLabel}</span>
                    <select
                      className={styles.newSessionSelect}
                      value={selectedLanUrl || status.primaryLanUrl}
                      onChange={(e) => setSelectedLanUrl(e.target.value)}
                    >
                      {status.lanEndpoints.map((ep) => (
                        <option key={ep.url} value={ep.url}>
                          {ep.kind === 'tailscale'
                            ? `[${t.remoteControl.tailscaleBadge}] `
                            : `[${t.remoteControl.lanBadge}] `}
                          {ep.address} ({ep.name})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <p className={styles.remoteModeHint}>{t.remoteControl.lanHint}</p>
              </div>
            )}

            {mode === 'tunnel' && status?.tunnel.status === 'running' && (
              <div className={styles.remoteTunnelBar}>
                <span className={styles.remoteTunnelRunningBadge}>
                  ● {t.remoteControl.tunnelRunningBadge(status.tunnel.provider || 'HTTPS')}
                </span>
                {!status.isRemoteClient && (
                  <button
                    type="button"
                    className={styles.newSessionCancelBtn}
                    disabled={busy}
                    onClick={() => void handleStopTunnel()}
                  >
                    {t.remoteControl.tunnelStopBtn}
                  </button>
                )}
              </div>
            )}

            {mode === 'custom' && (
              <div className={styles.remoteControlSection}>
                <label className={styles.remoteFieldLabel}>
                  <span>{t.remoteControl.customUrlLabel}</span>
                  <input
                    type="url"
                    className={styles.newSessionInput}
                    placeholder={t.remoteControl.customUrlPlaceholder}
                    value={customUrlInput}
                    disabled={status?.isRemoteClient}
                    onChange={(e) => void handleSaveCustomUrl(e.target.value)}
                  />
                </label>
                <p className={styles.remoteModeHint}>{t.remoteControl.customUrlHint}</p>
              </div>
            )}

            {/* Antigravity-style Read-only Monospace URL Box + Copy Button */}
            <div className={styles.remoteControlSection}>
              <span className={styles.remoteFieldTitle}>{t.remoteControl.urlLabel}</span>
              <div className={styles.remoteUrlBox}>
                <code className={styles.remoteUrlText} title={pairingUrl}>
                  {pairingUrl}
                </code>
                <button
                  type="button"
                  className={styles.remoteCopyBtn}
                  onClick={() => void handleCopy()}
                >
                  {copied ? t.common.copied : t.remoteControl.copyUrl}
                </button>
              </div>
            </div>

            {/* Host Settings (Enable Toggle, Device Name, Key Reset) */}
            {!status?.isRemoteClient && status && (
              <div className={styles.remoteSettingsBox}>
                <div className={styles.remoteSettingRow}>
                  <div>
                    <strong>{t.remoteControl.enableLabel}</strong>
                    <p>{t.remoteControl.enableDesc}</p>
                  </div>
                  <input
                    type="checkbox"
                    className={styles.remoteSwitch}
                    checked={status.enabled}
                    disabled={busy}
                    onChange={(e) => void handleToggleEnabled(e.target.checked)}
                    aria-label={t.remoteControl.enableLabel}
                  />
                </div>

                <div className={styles.remoteSettingRow}>
                  <label className={styles.remoteDeviceRow}>
                    <span>{t.remoteControl.deviceNameLabel}</span>
                    <div className={styles.remoteDeviceInputGroup}>
                      <input
                        type="text"
                        className={styles.newSessionInputSmall}
                        value={deviceNameInput}
                        placeholder={t.remoteControl.deviceNamePlaceholder}
                        onChange={(e) => setDeviceNameInput(e.target.value)}
                      />
                      <button
                        type="button"
                        className={styles.newSessionProjectBtn}
                        disabled={busy || deviceNameInput.trim() === status.deviceName}
                        onClick={() => void handleSaveDeviceName()}
                      >
                        {savedDevice
                          ? t.remoteControl.savedDeviceName
                          : t.remoteControl.saveDeviceName}
                      </button>
                      <button
                        type="button"
                        className={styles.newSessionProjectBtnDanger}
                        disabled={busy}
                        onClick={() => void handleRotateToken()}
                      >
                        {rotatedNotice
                          ? t.remoteControl.tokenRotated
                          : t.remoteControl.rotateTokenBtn}
                      </button>
                    </div>
                  </label>
                </div>
              </div>
            )}

            {/* PWA Home Screen Installation Guide */}
            <details className={styles.remotePwaGuide}>
              <summary>{t.remoteControl.pwaGuideTitle}</summary>
              <ul>
                <li>{t.remoteControl.pwaIosStep}</li>
                <li>{t.remoteControl.pwaAndroidStep}</li>
              </ul>
            </details>
          </div>
        </div>
      )}
    </dialog>
  );
}
