import React, { createContext, useContext, useEffect, useState, useMemo, type ReactNode } from 'react';
import type { SupportedLocale, LocaleInfo, Translations } from './types.js';
import { zhCN } from './locales/zh-CN.js';
import { zhTW } from './locales/zh-TW.js';
import { enUS } from './locales/en-US.js';
import { jaJP } from './locales/ja-JP.js';
import { translateDynamicText } from './translateDynamic.js';

export const AVAILABLE_LOCALES: LocaleInfo[] = [
  { code: 'zh-CN', label: '简', name: '简体中文' },
  { code: 'zh-TW', label: '繁', name: '繁體中文' },
  { code: 'en-US', label: 'EN', name: 'English' },
  { code: 'ja-JP', label: '日', name: '日本語' },
];

const LOCAL_STORAGE_KEY = 'agent-board-locale';

const translationsMap: Record<SupportedLocale, Translations> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en-US': enUS,
  'ja-JP': jaJP,
};

interface I18nContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: Translations;
  tr: (text?: string) => string;
  availableLocales: LocaleInfo[];
  formatTime: (date: Date | number | string, options?: Intl.DateTimeFormatOptions) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function getInitialLocale(): SupportedLocale {
  try {
    if (typeof window !== 'undefined') {
      const urlParam = new URLSearchParams(window.location.search).get('lang');
      if (urlParam) {
        const normalized = urlParam.toLowerCase();
        if (normalized === 'en' || normalized === 'en-us') return 'en-US';
        if (normalized === 'zh' || normalized === 'zh-cn' || normalized === 'zh-hans') return 'zh-CN';
        if (normalized === 'zh-tw' || normalized === 'zh-hant' || normalized === 'zh-hk') return 'zh-TW';
        if (normalized === 'ja' || normalized === 'ja-jp') return 'ja-JP';
      }
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY) as SupportedLocale | null;
      if (saved && saved in translationsMap) return saved;
    }
  } catch {}
  return 'zh-CN';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(getInitialLocale);

  const setLocale = (newLocale: SupportedLocale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, newLocale);
    } catch {}
  };

  const t = useMemo(() => translationsMap[locale] ?? zhCN, [locale]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang =
        locale === 'zh-TW' ? 'zh-TW' : locale === 'ja-JP' ? 'ja' : locale === 'zh-CN' ? 'zh-CN' : 'en';
      document.title = `${t.topbar.title} · ${t.topbar.dashboard}`;
    }
  }, [locale, t]);

  const formatTime = (
    date: Date | number | string,
    options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' },
  ) => {
    try {
      const d = typeof date === 'object' ? date : new Date(date);
      return d.toLocaleTimeString(locale, options);
    } catch {
      return String(date);
    }
  };

  const tr = (text?: string) => translateDynamicText(text, locale);

  const value: I18nContextValue = {
    locale,
    setLocale,
    t,
    tr,
    availableLocales: AVAILABLE_LOCALES,
    formatTime,
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    return {
      locale: 'zh-CN',
      setLocale: () => {},
      t: zhCN,
      tr: (text?: string) => text ?? '',
      availableLocales: AVAILABLE_LOCALES,
      formatTime: (date, options) => {
        try {
          return new Date(date).toLocaleTimeString('zh-CN', options);
        } catch {
          return String(date);
        }
      },
    };
  }
  return context;
}
