import React, { memo } from 'react';
import { CopyButton } from './CopyButton.js';
import { useI18n } from './i18n/index.js';
import styles from './Board.module.css';

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!node) return '';
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node) && node.props && (node.props as any).children) {
    return extractText((node.props as any).children);
  }
  return '';
}

function extractLanguage(children: React.ReactNode): string {
  if (React.isValidElement(children) && children.props) {
    const className = (children.props as any).className;
    if (typeof className === 'string') {
      const match = /language-([a-zA-Z0-9_#+-]+)/.exec(className);
      if (match) return match[1];
    }
  }
  if (Array.isArray(children)) {
    for (const child of children) {
      const lang = extractLanguage(child);
      if (lang) return lang;
    }
  }
  return '';
}

export interface MarkdownCodeBlockProps extends React.HTMLAttributes<HTMLPreElement> {
  children?: React.ReactNode;
}

export const MarkdownCodeBlock = memo(function MarkdownCodeBlock({
  children,
  className,
  ...props
}: MarkdownCodeBlockProps) {
  const { t } = useI18n();
  const rawText = extractText(children).replace(/\r?\n$/, '');
  const lang = extractLanguage(children);

  const displayLang = (lang || 'code').toLowerCase();

  return (
    <div className={styles.codeBlockWrapper}>
      <div className={styles.codeBlockHeader}>
        <span className={styles.codeBlockLang}>{displayLang}</span>
        <CopyButton
          text={rawText}
          label={t.card.copyCode}
          copiedLabel={t.common.copied}
          variant="code"
        />
      </div>
      <pre className={`${styles.codeBlockPre} ${className || ''}`} {...props}>
        {children}
      </pre>
    </div>
  );
});
