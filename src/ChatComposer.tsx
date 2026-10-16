import { useEffect, useRef, useState } from 'react';
import type { InteractionAttachment } from '../shared/interaction.js';
import { request } from './api.js';
import { useI18n } from './i18n/index.js';
import styles from './Board.module.css';

export interface AttachedFileItem {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  previewUrl?: string;
  localPath?: string;
  url?: string;
  uploading: boolean;
  error?: string;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentThumb({ att }: { att: AttachedFileItem }) {
  const isImage =
    att.mimeType?.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(att.name);
  const [triedUrl, setTriedUrl] = useState(false);
  const [hasError, setHasError] = useState(false);

  const initialSrc = att.previewUrl || (isImage ? att.url : undefined);
  const [currentSrc, setCurrentSrc] = useState<string | undefined>(initialSrc);

  useEffect(() => {
    if (att.previewUrl) {
      setCurrentSrc(att.previewUrl);
      setHasError(false);
      setTriedUrl(false);
    } else if (isImage && att.url) {
      setCurrentSrc(att.url);
      setHasError(false);
    }
  }, [att.previewUrl, att.url, isImage]);

  if (!isImage || hasError || !currentSrc) {
    return (
      <span className={styles.attachmentIcon} aria-hidden="true">
        {isImage ? '🖼️' : '📄'}
      </span>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={att.name}
      className={styles.attachmentThumb}
      onError={() => {
        if (!triedUrl && att.url && currentSrc !== att.url) {
          setTriedUrl(true);
          setCurrentSrc(att.url);
        } else {
          setHasError(true);
        }
      }}
    />
  );
}

export interface ChatComposerProps {
  id?: string;
  sessionId?: string;
  value: string;
  onChange: (value: string) => void;
  attachments?: AttachedFileItem[];
  onAttachmentsChange?: (
    attachments: AttachedFileItem[] | ((prev: AttachedFileItem[]) => AttachedFileItem[]),
  ) => void;
  onSubmit?: () => void;
  submitOnEnter?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  label?: React.ReactNode;
  disabled?: boolean;
  autoFocus?: boolean;
  inputRef?: React.Ref<HTMLTextAreaElement>;
  rows?: number;
  onError?: (error: string) => void;
  className?: string;
  hideTools?: boolean;
  hint?: React.ReactNode;
}

export function ChatComposer({
  id,
  sessionId,
  value,
  onChange,
  attachments: controlledAttachments,
  onAttachmentsChange,
  onSubmit,
  submitOnEnter = true,
  placeholder,
  ariaLabel,
  label,
  disabled = false,
  autoFocus = false,
  inputRef,
  rows = 3,
  onError,
  className,
  hideTools = false,
  hint,
}: ChatComposerProps) {
  const { t, locale } = useI18n();
  const [internalAttachments, setInternalAttachments] = useState<AttachedFileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const attachments = controlledAttachments ?? internalAttachments;
  const setAttachments = (
    updater: AttachedFileItem[] | ((prev: AttachedFileItem[]) => AttachedFileItem[]),
  ) => {
    if (onAttachmentsChange) {
      onAttachmentsChange(updater);
    } else {
      setInternalAttachments(updater);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const recognitionRef = useRef<any>(null);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const valueRef = useRef(value);
  valueRef.current = value;

  const uploadEndpoint = sessionId
    ? `/api/sessions/${encodeURIComponent(sessionId)}/attachments`
    : '/api/draft/attachments';

  const deleteEndpoint = (attId: string) =>
    sessionId
      ? `/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attId)}`
      : `/api/draft/attachments/${encodeURIComponent(attId)}`;

  const handleAddFiles = (files: File[]) => {
    if (!files.length) return;
    const maxFileSize = 25 * 1024 * 1024;
    for (const file of files) {
      if (file.size > maxFileSize) {
        onError?.(`${file.name}: ${t.interaction.fileTooLarge}`);
        continue;
      }
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const isImg =
        file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name);
      let previewUrl: string | undefined = undefined;
      if (isImg) {
        try {
          previewUrl = URL.createObjectURL(file);
        } catch {
          // ignore
        }
      }

      const newAttachment: AttachedFileItem = {
        id: tempId,
        name: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        previewUrl,
        uploading: true,
      };

      setAttachments((prev) => [...prev, newAttachment]);

      const reader = new FileReader();
      reader.onload = async () => {
        const result = (reader.result as string) || '';
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        const dataUrl = isImg && result.startsWith('data:') ? result : undefined;

        if (dataUrl) {
          setAttachments((prev) =>
            prev.map((item) =>
              item.id === tempId ? { ...item, previewUrl: dataUrl } : item,
            ),
          );
        }

        try {
          const uploaded = await request<InteractionAttachment>(uploadEndpoint, {
            name: file.name,
            mimeType: file.type,
            data: base64,
          });
          setAttachments((prev) =>
            prev.map((item) =>
              item.id === tempId
                ? {
                    ...item,
                    id: uploaded.id,
                    localPath: uploaded.localPath,
                    url: uploaded.url,
                    previewUrl: dataUrl || item.previewUrl || uploaded.url,
                    uploading: false,
                  }
                : item,
            ),
          );
        } catch (err) {
          setAttachments((prev) =>
            prev.map((item) =>
              item.id === tempId
                ? { ...item, uploading: false, error: (err as Error).message }
                : item,
            ),
          );
          onError?.(`${file.name}: ${t.interaction.uploadFailed} (${(err as Error).message})`);
        }
      };
      reader.onerror = () => {
        setAttachments((prev) =>
          prev.map((item) =>
            item.id === tempId
              ? { ...item, uploading: false, error: t.interaction.uploadFailed }
              : item,
          ),
        );
      };
      reader.readAsDataURL(file);
    }
  };

  const removeAttachment = (attachmentId: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === attachmentId);
      if (target?.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((a) => a.id !== attachmentId);
    });
    void fetch(deleteEndpoint(attachmentId), {
      method: 'DELETE',
    }).catch(() => {});
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const filesToUpload: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          if (file.name === 'image.png' || !file.name) {
            const mimeType = file.type || 'image/png';
            const rawExt = mimeType.split('/')[1]?.split('+')[0] || 'png';
            const ext = rawExt === 'jpeg' ? 'jpg' : rawExt;
            const now = new Date();
            const timeStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
            const namedFile = new File([file], `screenshot_${timeStr}.${ext}`, {
              type: mimeType,
            });
            filesToUpload.push(namedFile);
          } else {
            filesToUpload.push(file);
          }
        }
      }
    }
    if (filesToUpload.length > 0) {
      e.preventDefault();
      handleAddFiles(filesToUpload);
    }
  };

  const speechLangMap: Record<string, string> = {
    'zh-CN': 'zh-CN',
    'zh-TW': 'zh-TW',
    'en-US': 'en-US',
    'ja-JP': 'ja-JP',
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : undefined;

    if (!SpeechRecognition) {
      onError?.(t.interaction.voiceUnsupported);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = speechLangMap[locale] || 'zh-CN';

      let accumulated = '';

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const item = event.results[i];
          if (item.isFinal) {
            accumulated += item[0].transcript;
          } else {
            interim += item[0].transcript;
          }
        }
        if (accumulated || interim) {
          const prev = valueRef.current;
          const prefix =
            prev && !prev.endsWith(' ') && !prev.endsWith('\n') ? `${prev} ` : prev;
          onChange(`${prefix}${accumulated}${interim}`);
          accumulated = '';
        }
      };

      recognition.onerror = (e: any) => {
        setIsListening(false);
        if (e.error !== 'no-speech') {
          onError?.(`${t.interaction.voiceUnsupported}: ${e.error}`);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      setIsListening(false);
      onError?.((err as Error).message);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      onSubmit?.();
    } else if (e.key === 'Enter' && !e.shiftKey && submitOnEnter) {
      e.preventDefault();
      onSubmit?.();
    }
  };

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
      if (!controlledAttachments) {
        attachmentsRef.current.forEach((a) => {
          if (a.previewUrl?.startsWith('blob:')) {
            URL.revokeObjectURL(a.previewUrl);
          }
        });
      }
    };
  }, [controlledAttachments]);

  return (
    <div
      className={`${styles.composerBox} ${className || ''}`}
      onDragEnter={(e) => {
        e.preventDefault();
        dragCounter.current++;
        if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!isDragging && e.dataTransfer.types.includes('Files')) setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragCounter.current--;
        if (dragCounter.current <= 0) {
          dragCounter.current = 0;
          setIsDragging(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragCounter.current = 0;
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          handleAddFiles(Array.from(e.dataTransfer.files));
        }
      }}
    >
      {isDragging && (
        <div className={styles.dropOverlay}>
          <span>📥 {t.interaction.dragDropHint}</span>
        </div>
      )}

      {attachments.length > 0 && (
        <div className={styles.attachmentList}>
          {attachments.map((att) => (
            <div key={att.id} className={styles.attachmentChip}>
              <AttachmentThumb att={att} />
              <div className={styles.attachmentInfo}>
                <span className={styles.attachmentName} title={att.name}>
                  {att.name}
                </span>
                <span className={styles.attachmentSize}>
                  {att.uploading
                    ? t.interaction.uploading
                    : att.error
                      ? att.error
                      : formatBytes(att.size)}
                </span>
              </div>
              {att.uploading ? (
                <span className={styles.attachmentSpinner} aria-label={t.interaction.uploading} />
              ) : (
                <button
                  type="button"
                  className={styles.attachmentRemoveBtn}
                  title={t.interaction.removeAttachment}
                  onClick={() => removeAttachment(att.id)}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className={styles.composer}>
        {label && <span>{label}</span>}
        <textarea
          id={id}
          ref={inputRef}
          aria-label={ariaLabel || (typeof label === 'string' ? label : undefined)}
          maxLength={32000}
          rows={rows}
          value={value}
          disabled={disabled}
          onPaste={handlePaste}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
        />
      </div>

      {!hideTools && (
        <div className={styles.composerTools}>
          <input
            type="file"
            ref={fileInputRef}
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files?.length) {
                handleAddFiles(Array.from(e.target.files));
                e.target.value = '';
              }
            }}
          />
          <button
            type="button"
            className={styles.composerToolBtn}
            title={t.interaction.attachFiles}
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
          >
            📎 {t.interaction.attachFiles}
          </button>
          <button
            type="button"
            className={`${styles.composerToolBtn} ${isListening ? styles.listeningBtn : ''}`}
            title={isListening ? t.interaction.stopVoice : t.interaction.voiceInput}
            onClick={toggleListening}
            disabled={disabled}
          >
            🎙️ {isListening ? t.interaction.stopVoice : t.interaction.voiceInput}
          </button>
          {isListening && (
            <span className={styles.voiceStatus}>
              ● {t.interaction.voiceListening}
            </span>
          )}
          {hint && (
            <span className={styles.newSessionShortcutHint}>
              {hint}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
