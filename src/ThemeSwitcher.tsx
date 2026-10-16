import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { useI18n } from './i18n/index.js';
import { getThemePreference, setThemePreference, type ThemePreference } from './theme.js';
import { playSound } from './sound.js';
import styles from './Board.module.css';

const svgProps = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const ICONS: Record<ThemePreference, ReactNode> = {
  system: (
    <svg {...svgProps}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  ),
  light: (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  dark: (
    <svg {...svgProps}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  ),
};

const ORDER: ThemePreference[] = ['system', 'light', 'dark'];

export function ThemeSwitcher() {
  const { t } = useI18n();
  const [pref, setPref] = useState<ThemePreference>(() => getThemePreference());

  const labels: Record<ThemePreference, string> = {
    system: t.common.themeSystem,
    light: t.common.themeLight,
    dark: t.common.themeDark,
  };

  const choose = (next: ThemePreference) => {
    if (next === pref) return;
    setPref(next);
    setThemePreference(next);
    playSound('click');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = ORDER[(index + step + ORDER.length) % ORDER.length]!;
    choose(next);
    (event.currentTarget.parentElement?.querySelector(`[data-theme-option="${next}"]`) as HTMLElement | null)?.focus();
  };

  return (
    <div className={styles.themeSwitch} role="radiogroup" aria-label={t.common.theme} title={t.common.theme}>
      {ORDER.map((option, index) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={pref === option}
          aria-label={labels[option]}
          title={labels[option]}
          tabIndex={pref === option ? 0 : -1}
          data-theme-option={option}
          data-active={pref === option}
          className={styles.themeOption}
          onClick={() => choose(option)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {ICONS[option]}
        </button>
      ))}
    </div>
  );
}
