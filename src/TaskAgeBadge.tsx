import { useEffect, useState } from 'react';
import type { Execution } from '../shared/types.js';
import { useI18n } from './i18n/index.js';
import styles from './Board.module.css';

export type FreshnessLevel = 'fresh' | 'quiet' | 'lagging' | 'stale' | 'inactive';

export interface TaskAgeBadgeProps {
  updatedAt: number;
  execution: Execution;
  activityLabel?: '近期有输出' | '暂未更新';
  compact?: boolean;
  className?: string;
}

export function getFreshnessInfo(
  updatedAt: number,
  execution: Execution,
  activityLabel?: '近期有输出' | '暂未更新',
  now: number = Date.now(),
): {
  diffSec: number;
  level: FreshnessLevel;
} {
  if (!updatedAt || updatedAt <= 0) {
    return { diffSec: Infinity, level: 'inactive' };
  }
  const diffSec = Math.max(0, Math.floor((now - updatedAt) / 1000));

  if (execution === 'RUNNING') {
    if (diffSec < 60) return { diffSec, level: 'fresh' };
    if (diffSec < 300) return { diffSec, level: 'quiet' };
    if (diffSec < 900) return { diffSec, level: 'lagging' };
    return { diffSec, level: 'stale' };
  }

  if (execution === 'WAITING_INPUT' || execution === 'WAITING_APPROVAL') {
    if (diffSec < 120) return { diffSec, level: 'fresh' };
    if (diffSec < 600) return { diffSec, level: 'quiet' };
    if (diffSec < 1800) return { diffSec, level: 'lagging' };
    return { diffSec, level: 'stale' };
  }

  if (execution === 'UNKNOWN') {
    if (activityLabel === '近期有输出' && diffSec < 60) {
      return { diffSec, level: 'fresh' };
    }
    if (diffSec < 300) return { diffSec, level: 'quiet' };
    if (diffSec < 900) return { diffSec, level: 'lagging' };
    return { diffSec, level: 'stale' };
  }

  return { diffSec, level: 'inactive' };
}

export function useNow(intervalMs = 3000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function formatAgeString(
  diffSec: number,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (diffSec < 10) return t.card.ageJustNow;
  if (diffSec < 60) return t.card.ageSecondsAgo(diffSec);
  if (diffSec < 3600) return t.card.ageMinutesAgo(Math.floor(diffSec / 60));
  if (diffSec < 86400) return t.card.ageHoursAgo(Math.floor(diffSec / 3600));
  return t.card.ageDaysAgo(Math.floor(diffSec / 86400));
}

export function getFreshnessTooltip(
  level: FreshnessLevel,
  ageText: string,
  updatedAt: number,
  locale: string,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (!updatedAt || updatedAt <= 0) return '';
  const d = new Date(updatedAt);
  const timeStr = d.toLocaleTimeString(locale, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  switch (level) {
    case 'fresh':
      return t.card.freshnessActiveTooltip(ageText, timeStr);
    case 'quiet':
      return t.card.freshnessQuietTooltip(ageText, timeStr);
    case 'lagging':
      return t.card.freshnessLaggingTooltip(ageText, timeStr);
    case 'stale':
      return t.card.freshnessStaleTooltip(ageText, timeStr);
    case 'inactive':
    default:
      return t.card.freshnessInactiveTooltip(`${d.toLocaleDateString(locale)} ${timeStr}`);
  }
}

export function TaskAgeBadge({
  updatedAt,
  execution,
  activityLabel,
  compact = false,
  className,
}: TaskAgeBadgeProps) {
  const { t, locale } = useI18n();
  const now = useNow(3000);

  if (!updatedAt || updatedAt <= 0) return null;

  const { diffSec, level } = getFreshnessInfo(updatedAt, execution, activityLabel, now);
  const ageText = formatAgeString(diffSec, t);
  const tooltip = getFreshnessTooltip(level, ageText, updatedAt, locale, t);

  return (
    <span
      className={`${styles.ageBadge} ${compact ? styles.compactAgeBadge : ''} ${className ?? ''}`}
      data-freshness={level}
      title={tooltip}
      aria-label={tooltip}
    >
      <i className={styles.ageDot} aria-hidden="true" />
      <time className={styles.ageTime}>{ageText}</time>
    </span>
  );
}
