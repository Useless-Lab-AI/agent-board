import { useI18n } from './I18nContext.js';
import type { SupportedLocale } from './types.js';
import styles from '../Board.module.css';

export function LanguageSwitcher() {
  const { locale, setLocale, availableLocales, t } = useI18n();

  return (
    <div className={styles.langSelector} title={t.common.language}>
      <span className={styles.langIcon} aria-hidden="true">
        🌐
      </span>
      <select
        aria-label={t.common.language}
        value={locale}
        onChange={(e) => setLocale(e.target.value as SupportedLocale)}
        className={styles.langSelect}
      >
        {availableLocales.map((item) => (
          <option key={item.code} value={item.code}>
            {item.name}
          </option>
        ))}
      </select>
    </div>
  );
}
