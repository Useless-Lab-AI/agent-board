export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'agent-board-theme';

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isPreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

/** 'system' removes the override so `color-scheme: light dark` follows the OS. */
export function applyTheme(pref: ThemePreference): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

export function setThemePreference(pref: ThemePreference): void {
  try {
    if (pref === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* storage unavailable: still apply for this session */
  }
  applyTheme(pref);
}

if (typeof window !== 'undefined') {
  applyTheme(getThemePreference());
  // keep multiple tabs / windows in sync
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) applyTheme(getThemePreference());
  });
}
