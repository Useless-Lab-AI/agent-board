import { useEffect, useRef, useState } from 'react';
import { withRemoteAuthUrl } from './api.js';
import { useI18n } from './i18n/index.js';
import { playSound } from './sound.js';
import styles from './Board.module.css';

export function PwaInstallModal({
  isOpen,
  hasNativePrompt,
  isStartingHttps,
  installError,
  onTriggerNativeInstall,
  onStartHttpsInstall,
  onClose,
}: {
  isOpen: boolean;
  hasNativePrompt: boolean;
  isStartingHttps: boolean;
  installError?: string;
  onTriggerNativeInstall: () => Promise<boolean>;
  onStartHttpsInstall: () => Promise<void>;
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  const [waitingForKernel, setWaitingForKernel] = useState(true);

  const isEn = locale === 'en-US';
  const isTw = locale === 'zh-TW';
  const isJa = locale === 'ja-JP';

  const isIos =
    typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  const isSecure = typeof window !== 'undefined' && window.isSecureContext;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || hasNativePrompt || !isSecure || isIos) {
      setWaitingForKernel(false);
      return;
    }
    setWaitingForKernel(true);
    const timer = setTimeout(() => {
      setWaitingForKernel(false);
    }, 2200);
    return () => clearTimeout(timer);
  }, [isOpen, hasNativePrompt, isSecure, isIos]);

  // Fallback for browsers that do not yet support closedby="any" on <dialog>
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !isOpen) return;
    if ('closedBy' in HTMLDialogElement.prototype) return;
    const handleClick = (event: MouseEvent) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const isDialogContent =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!isDialogContent) {
        dialog.close();
      }
    };
    dialog.addEventListener('click', handleClick);
    return () => dialog.removeEventListener('click', handleClick);
  }, [isOpen]);

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      playSound('click');
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {}
  };

  return (
    <dialog
      ref={dialogRef}
      closedby="any"
      className={`${styles.dialog} ${styles.pwaModal}`}
      onCancel={onClose}
      onClose={onClose}
      aria-labelledby="pwa-install-modal-title"
    >
      {isOpen && (
        <div className={styles.pwaSheetContainer}>
          <div className={styles.pwaSheetHandleWrap} aria-hidden="true">
            <span className={styles.pwaSheetHandle} />
          </div>

          <header className={styles.pwaSheetHeader}>
            <div className={styles.pwaSheetBrand}>
              <div className={styles.pwaSheetIconBox}>
                <img
                  src={withRemoteAuthUrl('/icon.svg')}
                  alt=""
                  className={styles.pwaSheetIcon}
                  aria-hidden="true"
                />
              </div>
              <div className={styles.pwaSheetTitleGroup}>
                <h3 id="pwa-install-modal-title">
                  {isEn
                    ? '1-Click Desktop App'
                    : isJa
                      ? 'ワンタップでアプリを作成'
                      : isTw
                        ? '一鍵建立 Agent Board 桌面應用'
                        : '一键创建 Agent Board 桌面应用'}
                </h3>
                <p>
                  {isEn
                    ? 'Full-screen standalone app · Auto-signed in · Permanent LAN fallback'
                    : isJa
                      ? '全画面アプリ表示・自動認証・LAN常時接続対応'
                      : isTw
                        ? '像 Antigravity / Gemini 一樣全螢幕獨立運行 · 內建免密授權'
                        : '像 Antigravity / Gemini 一样全屏独立运行 · 自带免密授权'}
                </p>
              </div>
            </div>
            <button
              type="button"
              className={styles.iconButton}
              onClick={onClose}
              aria-label={isEn ? 'Close' : '关闭'}
            >
              ✕
            </button>
          </header>

          <div className={styles.pwaSheetChips}>
            <span className={styles.pwaSheetChip}>
              ✨ {isEn ? 'Full-Screen App' : isTw ? '全螢幕無地址欄' : '全屏无地址栏'}
            </span>
            <span className={styles.pwaSheetChip}>
              🔑 {isEn ? 'Auto-Signed In' : isTw ? '自帶授權免掃碼' : '自带授权免扫码'}
            </span>
            <span className={styles.pwaSheetChip}>
              ⚡ {isEn ? 'LAN Auto-Fallback' : isTw ? '局域網直連防失效' : '局域网直连防失效'}
            </span>
          </div>

          {installError && (
            <div className={styles.pwaTipNotice}>
              <strong>⚠️ {installError}</strong>
            </div>
          )}

          {isIos ? (
            <a
              href={withRemoteAuthUrl('/api/pwa/install.mobileconfig')}
              className={styles.pwaNativeInstallBtn}
              style={{ textDecoration: 'none' }}
              onClick={() => playSound('click')}
            >
              <span>📲</span>
              <span>
                {isEn
                  ? '1-Click Install iOS Web App'
                  : isTw
                    ? '一鍵安裝 iOS 桌面應用'
                    : '一键安装 iOS 桌面应用'}
              </span>
            </a>
          ) : hasNativePrompt ? (
            <button
              type="button"
              className={styles.pwaNativeInstallBtn}
              onClick={() => void onTriggerNativeInstall()}
            >
              <span>📲</span>
              <span>
                {isEn
                  ? 'Create Desktop App Now (1-Click)'
                  : isJa
                    ? '今すぐホーム画面にアプリを作成'
                    : isTw
                      ? '立即一鍵建立桌面應用'
                      : '立即一键创建桌面应用'}
              </span>
            </button>
          ) : !isSecure ? (
            <>
              <div className={styles.pwaTipNotice}>
                <strong>
                  {isEn
                    ? '🔒 Why does LAN HTTP need a 1-click HTTPS channel?'
                    : isTw
                      ? '🔒 為什麼局域網 http:// 需要開啟安全通道才能一鍵安裝？'
                      : '🔒 为什么局域网 http:// 需要开启安全通道才能一键创建？'}
                </strong>
                <span>
                  {isEn
                    ? 'Android browsers disable the 1-click PWA install API on plain http:// LAN IPs. Tap below to automatically switch to HTTPS and pop up the native 1-click installer (once installed, it automatically reconnects over LAN!).'
                    : isTw
                      ? '安卓瀏覽器內核在普通 http:// 局域網 IP 下會禁用一鍵安裝介面。點擊下方按鈕將自動切換至 HTTPS 安全通道並彈出系統原生一鍵安裝（安裝後桌面圖示會自動回退走局域網直連，永久有效）！'
                      : '安卓浏览器内核在普通 http:// 局域网 IP 下会强制禁用一键安装接口。点击下方按钮将自动切换至 HTTPS 安全通道并弹出系统原生一键安装（安装后桌面图标会自动回退走局域网直连，永久有效）！'}
                </span>
              </div>
              <button
                type="button"
                className={styles.pwaNativeInstallBtn}
                disabled={isStartingHttps}
                onClick={() => void onStartHttpsInstall()}
              >
                <span>{isStartingHttps ? '⏳' : '🚀'}</span>
                <span>
                  {isStartingHttps
                    ? isEn
                      ? 'Starting HTTPS 1-Click Installer…'
                      : isTw
                        ? '正在開啟安全通道並準備一鍵安裝…'
                        : '正在开启安全通道并准备一键安装…'
                    : isEn
                      ? '1-Click Create Desktop App (Auto HTTPS)'
                      : isTw
                        ? '一鍵建立桌面應用（自動開啟安全通道）'
                        : '一键创建桌面应用（自动开启安全通道）'}
                </span>
              </button>
            </>
          ) : waitingForKernel ? (
            <button type="button" className={styles.pwaNativeInstallBtn} disabled>
              <span>⏳</span>
              <span>
                {isEn
                  ? 'Preparing Native 1-Click Installer…'
                  : isTw
                    ? '正在喚醒系統原生一鍵安裝組件…'
                    : '正在唤醒系统原生一键安装组件…'}
              </span>
            </button>
          ) : (
            <div className={styles.pwaTipNotice}>
              <strong>
                {isEn
                  ? '💡 Native 1-click install already completed or blocked by current browser shell'
                  : isTw
                    ? '💡 已建立桌面應用，或目前瀏覽器殼層限制了系統安裝彈窗'
                    : '💡 已创建桌面应用，或当前浏览器限制了系统安装弹窗'}
              </strong>
              <span>
                {isEn
                  ? 'If Agent Board is not on your home screen yet, copy this HTTPS link and open it in Chrome or Edge for instant 1-click installation.'
                  : isTw
                    ? '若桌面尚未出現圖示，可複製下方 HTTPS 連結並在 Chrome / Edge 開啟，即可直接彈出系統一鍵安裝。'
                    : '若手机桌面尚未出现图标，可点击下方按钮复制当前 HTTPS 链接并在 Chrome / Edge 中打开，即可直接弹出系统一键安装。'}
              </span>
            </div>
          )}

          <footer className={styles.pwaSheetFooter}>
            <button
              type="button"
              className={styles.pwaCopyLinkBtn}
              onClick={() => void handleCopyUrl()}
            >
              {copied
                ? isEn
                  ? '✓ Link Copied'
                  : isTw
                    ? '✓ 已複製連結'
                    : '✓ 已复制链接'
                : isEn
                  ? '📋 Copy Authenticated App Link'
                  : isTw
                    ? '📋 複製帶免密授權的應用連結'
                    : '📋 复制带免密授权的应用链接'}
            </button>
            <button type="button" className={styles.pwaCloseSheetBtn} onClick={onClose}>
              {isEn ? 'Close' : isTw ? '關閉' : '关闭'}
            </button>
          </footer>
        </div>
      )}
    </dialog>
  );
}
