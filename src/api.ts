const REMOTE_TOKEN_STORAGE_KEY = 'agent_board_rc_token';
const LAN_ORIGIN_STORAGE_KEY = 'agent_board_lan_origin';

function isPrivateLanOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return (
      /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(
        u.hostname,
      ) || u.hostname.endsWith('.ts.net')
    );
  } catch {
    return false;
  }
}

export function saveLanOrigin(origin: string | null | undefined): void {
  if (typeof window === 'undefined' || !origin) return;
  try {
    const u = new URL(origin);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      localStorage.setItem(LAN_ORIGIN_STORAGE_KEY, u.origin);
    }
  } catch {}
}

export function getSavedLanOrigin(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(LAN_ORIGIN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function initRemoteToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const lanParam = params.get('lan');
    if (lanParam) {
      saveLanOrigin(lanParam);
    } else if (isPrivateLanOrigin(window.location.origin)) {
      saveLanOrigin(window.location.origin);
    }

    const urlToken = params.get('rc') ?? params.get('token');
    if (urlToken && urlToken.trim()) {
      const clean = urlToken.trim();
      try {
        localStorage.setItem(REMOTE_TOKEN_STORAGE_KEY, clean);
      } catch {}
      try {
        document.cookie = `agent_board_rc=${encodeURIComponent(clean)}; path=/; max-age=2592000; SameSite=Lax`;
      } catch {}
      return clean;
    }
    const stored = localStorage.getItem(REMOTE_TOKEN_STORAGE_KEY);
    if (stored && stored.trim()) {
      const clean = stored.trim();
      try {
        document.cookie = `agent_board_rc=${encodeURIComponent(clean)}; path=/; max-age=2592000; SameSite=Lax`;
      } catch {}
      // Keep ?rc= in URL on non-loopback hosts so iOS Safari "Add to Home Screen" bookmarks the token
      const isLoopback =
        window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
      if (!isLoopback && !params.get('rc')) {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('rc', clean);
        window.history.replaceState(null, '', nextUrl.toString());
      }
      return clean;
    }
  } catch {}
  return null;
}

const cachedRemoteToken = initRemoteToken();

export function getRemoteToken(): string | null {
  if (cachedRemoteToken) return cachedRemoteToken;
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(REMOTE_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function withRemoteAuthUrl(url: string): string {
  const token = getRemoteToken();
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}rc=${encodeURIComponent(token)}`;
}

let redirectingToLan = false;

function tryFallbackToLanOrigin(): boolean {
  if (typeof window === 'undefined' || redirectingToLan) return false;
  const savedLan = getSavedLanOrigin();
  if (!savedLan || savedLan === window.location.origin) return false;
  try {
    const target = new URL(savedLan);
    const currentParams = new URLSearchParams(window.location.search);
    const rc = getRemoteToken() || currentParams.get('rc') || '';
    if (rc) target.searchParams.set('rc', rc);
    const sessionParam = currentParams.get('session');
    if (sessionParam) target.searchParams.set('session', sessionParam);
    redirectingToLan = true;
    window.location.replace(target.toString());
    return true;
  } catch {
    return false;
  }
}

export async function request<T>(url: string, body?: unknown): Promise<T> {
  const token = getRemoteToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['X-Agent-Board-Token'] = token;
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['X-Agent-Board'] = '1';
  }
  const response = await fetch(
    url,
    body === undefined
      ? Object.keys(headers).length > 0
        ? { headers }
        : undefined
      : {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        },
  );

  const rawText = await response.text();
  let result: any = null;
  let isJson = false;
  if (rawText) {
    try {
      result = JSON.parse(rawText);
      isJson = true;
    } catch {
      isJson = false;
    }
  }

  if (isJson && result && typeof result === 'object') {
    if (typeof result.customUrl === 'string' && result.customUrl.startsWith('http')) {
      saveLanOrigin(result.customUrl);
    } else if (
      typeof result.primaryLanUrl === 'string' &&
      result.primaryLanUrl.startsWith('http')
    ) {
      saveLanOrigin(result.primaryLanUrl);
    }
  }

  if (!isJson || !response.ok) {
    const trimmed = rawText.trim();
    const isTunnelHost =
      typeof window !== 'undefined' &&
      /(\.lhr\.life|\.trycloudflare\.com|\.ngrok-free\.app|\.loca\.lt)$/i.test(
        window.location.hostname,
      );
    const isDeadTunnel =
      /^no tunnel$/i.test(trimmed) ||
      /no tunnel here/i.test(trimmed) ||
      /error 1033|argo tunnel error|cloudflare tunnel/i.test(trimmed) ||
      (isTunnelHost &&
        !isJson &&
        (response.status === 404 ||
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504));

    if (isDeadTunnel) {
      const switched = tryFallbackToLanOrigin();
      throw new Error(
        switched
          ? '临时 HTTPS 隧道已断开，正在自动切回局域网直连...'
          : '临时公网隧道已断开（no tunnel），请使用局域网地址访问或重新开启隧道',
      );
    }

    if (isJson && result && typeof result.error === 'string' && result.error) {
      throw new Error(result.error);
    }

    if (!response.ok) {
      const snippet =
        !isJson && trimmed && !trimmed.startsWith('<') ? `: ${trimmed.slice(0, 80)}` : '';
      throw new Error(`请求失败 (${response.status}${snippet})`);
    }

    throw new Error('服务返回了非 JSON 响应，请检查网络连接或刷新页面重试');
  }

  return result as T;
}

// Limit concurrent transcript reads when many cards become visible together.
let active = 0;
const waiting: (() => void)[] = [];
export async function readPage<T>(url: string): Promise<T> {
  if (active >= 4) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await request<T>(url);
  } finally {
    active--;
    waiting.shift()?.();
  }
}
