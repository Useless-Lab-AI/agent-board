import { useState, useCallback, memo } from 'react';
import { copyToClipboard } from './clipboard.js';
import { useI18n } from './i18n/index.js';
import styles from './Board.module.css';

export interface CopyButtonProps {
  text: string;
  label?: string;
  copiedLabel?: string;
  title?: string;
  className?: string;
  variant?: 'tool' | 'code' | 'message';
  showIcon?: boolean;
}

export const CopyButton = memo(function CopyButton({
  text,
  label,
  copiedLabel,
  title,
  className,
  variant = 'code',
  showIcon = true,
}: CopyButtonProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!text) return;
      const success = await copyToClipboard(text);
      if (success) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    },
    [text],
  );

  const rawCopiedText = copiedLabel ?? t.common.copied;
  const cleanCopiedText = showIcon ? rawCopiedText.replace(/^[✓✔]\s*/, '') : rawCopiedText;
  const defaultTitle = copied ? cleanCopiedText : (title || t.common.copyContent);
  const displayText = copied ? cleanCopiedText : (label ?? t.common.copy);

  let buttonClass = styles.codeCopyBtn;
  if (variant === 'tool') {
    buttonClass = styles.toolCopyBtn;
  } else if (variant === 'message') {
    buttonClass = styles.messageCopyBtn;
  }
  if (className) {
    buttonClass = `${buttonClass} ${className}`;
  }

  return (
    <button
      type="button"
      className={buttonClass}
      onClick={handleCopy}
      title={defaultTitle}
      aria-label={defaultTitle}
      data-copied={copied}
    >
      {showIcon && (
        <span className={styles.copyBtnIcon} aria-hidden="true">
          {copied ? (
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </span>
      )}
      <span className={styles.copyBtnText}>{displayText}</span>
    </button>
  );
});
