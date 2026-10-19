import { request, withRemoteAuthUrl } from './api.js';
import type { SessionView } from '../shared/types.js';

const PUSH_STORAGE_KEY = 'agent-board-push';

let pushEnabled =
  typeof window !== 'undefined' &&
  localStorage.getItem(PUSH_STORAGE_KEY) === 'true' &&
  (typeof Notification === 'undefined' || Notification.permission !== 'denied');

export function isPushEnabled(): boolean {
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
    return false;
  }
  return pushEnabled;
}

export function setPushEnabled(enabled: boolean): void {
  pushEnabled = enabled;
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(PUSH_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {}
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      (window.navigator as any).standalone === true
    );
  } catch {
    return false;
  }
}

export async function subscribeServiceWorkerPush(lang: string): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return false;
  try {
    const reg =
      (await navigator.serviceWorker.getRegistration('/')) ||
      (await navigator.serviceWorker.register(withRemoteAuthUrl('/sw.js'), { scope: '/' }));
    await navigator.serviceWorker.ready;
    if (!reg.pushManager) return false;

    const status = await request<{ publicKey: string }>('/api/push/status');
    if (!status?.publicKey) return false;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(status.publicKey),
      });
    }
    const subJson = sub.toJSON();
    if (subJson.endpoint && subJson.keys?.p256dh && subJson.keys?.auth) {
      await request('/api/push/subscribe', {
        subscription: {
          endpoint: subJson.endpoint,
          keys: {
            p256dh: subJson.keys.p256dh,
            auth: subJson.keys.auth,
          },
        },
        lang,
      });
      return true;
    }
  } catch {
    // Fallback to foreground/background tab notification API if PushManager is unavailable
  }
  return false;
}

export async function enablePushNotifications(lang: string): Promise<{
  ok: boolean;
  mode?: 'web-push' | 'local';
  reason?: 'ios-pwa-required' | 'insecure-context' | 'denied' | 'unsupported';
}> {
  if (typeof window === 'undefined') return { ok: false, reason: 'unsupported' };
  const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent || '');

  if (typeof Notification === 'undefined') {
    if (isIos && !isStandaloneMode()) {
      return { ok: false, reason: 'ios-pwa-required' };
    }
    if (!window.isSecureContext) {
      return { ok: false, reason: 'insecure-context' };
    }
    return { ok: false, reason: 'unsupported' };
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission();
    } catch {
      return { ok: false, reason: 'denied' };
    }
  }

  if (permission !== 'granted') {
    setPushEnabled(false);
    return { ok: false, reason: 'denied' };
  }

  setPushEnabled(true);
  const webPushSubscribed = await subscribeServiceWorkerPush(lang);
  return {
    ok: true,
    mode: webPushSubscribed ? 'web-push' : 'local',
  };
}

export async function disablePushNotifications(): Promise<void> {
  setPushEnabled(false);
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => {});
      if (endpoint) {
        await request('/api/push/unsubscribe', { endpoint }).catch(() => {});
      }
    }
  } catch {}
}

export async function syncPushSubscriptionIfEnabled(lang: string): Promise<void> {
  if (!isPushEnabled()) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  await subscribeServiceWorkerPush(lang);
}

export function triggerClientWaitingNotification(
  session: SessionView,
  title: string,
  body: string,
  onSelectSession?: (id: string) => void,
): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate([180, 80, 180]);
    } catch {}
  }

  if (!isPushEnabled()) return;
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;

  // Only show local notification when page is backgrounded or not focused
  const isBackground =
    document.visibilityState === 'hidden' ||
    (typeof document.hasFocus === 'function' && !document.hasFocus());
  if (!isBackground) return;

  const tag = `agent-board-wait-${session.id}`;
  const icon = withRemoteAuthUrl('/apple-touch-icon.png');
  const url = withRemoteAuthUrl(`/?session=${encodeURIComponent(session.id)}`);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .getRegistration('/')
      .then((reg) => {
        if (reg && typeof reg.showNotification === 'function') {
          return reg.showNotification(title, {
            body,
            icon,
            badge: icon,
            tag,
            renotify: true,
            requireInteraction: true,
            data: { url, sessionId: session.id },
          } as NotificationOptions);
        }
        const n = new Notification(title, { body, icon, tag });
        n.onclick = () => {
          window.focus();
          onSelectSession?.(session.id);
          n.close();
        };
      })
      .catch(() => {});
  } else {
    try {
      const n = new Notification(title, { body, icon, tag });
      n.onclick = () => {
        window.focus();
        onSelectSession?.(session.id);
        n.close();
      };
    } catch {}
  }
}
