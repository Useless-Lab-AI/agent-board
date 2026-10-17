const REMOTE_TOKEN_STORAGE_KEY = 'agent_board_rc_token';

function initRemoteToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
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
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `请求失败 (${response.status})`);
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
