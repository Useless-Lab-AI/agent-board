export async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Agent-Board': '1' },
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
