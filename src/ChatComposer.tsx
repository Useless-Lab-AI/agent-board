import { useEffect, useRef, useState } from 'react';
import type { InteractionAttachment } from '../shared/interaction.js';
import { request, withRemoteAuthUrl } from './api.js';
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

export function joinSpeechText(base: string, addition: string): string {
  if (!base) return addition;
  if (!addition) return base;
  if (
    /[\s\n，。！？、；：,.!?;:]$/.test(base) ||
    /^[\s\n，。！？、；：,.!?;:]/.test(addition)
  ) {
    return `${base}${addition}`;
  }
  const lastChar = base[base.length - 1];
  const firstChar = addition[0];
  const isCjkBoundary =
    /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(lastChar) ||
    /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(firstChar);
  return isCjkBoundary ? `${base}${addition}` : `${base} ${addition}`;
}

export function mergeSpeechSegments(segments: string[]): string {
  let acc = '';
  for (const raw of segments) {
    const seg = raw.trim();
    if (!seg) continue;
    if (!acc) {
      acc = seg;
      continue;
    }
    if (seg === acc || acc.endsWith(seg)) {
      continue;
    }
    if (seg.startsWith(acc)) {
      acc = seg;
      continue;
    }
    let overlapLen = 0;
    const maxOverlap = Math.min(acc.length, seg.length);
    for (let k = maxOverlap; k >= 2; k--) {
      if (acc.slice(acc.length - k) === seg.slice(0, k)) {
        overlapLen = k;
        break;
      }
    }
    if (overlapLen > 0) {
      acc = `${acc}${seg.slice(overlapLen)}`;
    } else {
      acc = joinSpeechText(acc, seg);
    }
  }
  return acc;
}

function AttachmentThumb({ att }: { att: AttachedFileItem }) {
  const isImage =
    att.mimeType?.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(att.name);
  const [triedUrl, setTriedUrl] = useState(false);
  const [hasError, setHasError] = useState(false);

  const authAttUrl = att.url ? withRemoteAuthUrl(att.url) : undefined;
  const initialSrc = att.previewUrl || (isImage ? authAttUrl : undefined);
  const [currentSrc, setCurrentSrc] = useState<string | undefined>(initialSrc);

  useEffect(() => {
    if (att.previewUrl) {
      setCurrentSrc(att.previewUrl);
      setHasError(false);
      setTriedUrl(false);
    } else if (isImage && authAttUrl) {
      setCurrentSrc(authAttUrl);
      setHasError(false);
    }
  }, [att.previewUrl, authAttUrl, isImage]);

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
    void fetch(withRemoteAuthUrl(deleteEndpoint(attachmentId)), {
      method: 'DELETE',
      headers: { 'X-Agent-Board': '1' },
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

  const wantListeningRef = useRef(false);
  const baseTextRef = useRef('');
  const committedVoiceRef = useRef('');
  const cycleVoiceRef = useRef('');
  const lastVoiceOutputRef = useRef('');
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!wantListeningRef.current) return;
    if (value !== lastVoiceOutputRef.current) {
      // User manually edited the textarea or cleared/submitted the message while listening
      baseTextRef.current = value;
      committedVoiceRef.current = '';
      cycleVoiceRef.current = '';
      lastVoiceOutputRef.current = value;
    }
  }, [value]);

  const stopListening = () => {
    wantListeningRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      try {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.stop();
      } catch {}
    }
    cycleVoiceRef.current = '';
    setIsListening(false);
  };

  const toggleListening = () => {
    if (isListening || wantListeningRef.current) {
      stopListening();
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

    wantListeningRef.current = true;
    baseTextRef.current = valueRef.current;
    committedVoiceRef.current = '';
    cycleVoiceRef.current = '';
    lastVoiceOutputRef.current = valueRef.current;

    const isMobile =
      typeof navigator !== 'undefined' &&
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

    const startCycle = () => {
      if (!wantListeningRef.current) return;
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }

      try {
        const recognition = new SpeechRecognition();
        // On mobile browsers (especially Android Chrome), continuous=true causes cumulative
        // duplicate transcripts across result items. Using single-utterance mode with automatic
        // seamless restart in onend eliminates mobile duplication while keeping listening active.
        recognition.continuous = !isMobile;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.lang = speechLangMap[locale] || 'zh-CN';

        recognition.onstart = () => {
          if (wantListeningRef.current) {
            setIsListening(true);
          }
        };

        recognition.onresult = (event: any) => {
          if (!wantListeningRef.current) return;
          const segments: string[] = [];
          const results = event?.results;
          if (results && typeof results.length === 'number') {
            for (let i = 0; i < results.length; i++) {
              const transcript = String(results[i]?.[0]?.transcript ?? '').trim();
              if (transcript) {
                segments.push(transcript);
              }
            }
          }
          const cycleText = mergeSpeechSegments(segments);
          cycleVoiceRef.current = cycleText;

          const combinedVoice = mergeSpeechSegments([
            committedVoiceRef.current,
            cycleText,
          ]);
          const nextValue = joinSpeechText(baseTextRef.current, combinedVoice);
          if (nextValue !== valueRef.current) {
            lastVoiceOutputRef.current = nextValue;
            onChange(nextValue);
          }
        };

        recognition.onerror = (e: any) => {
          const errCode = String(e?.error || '');
          if (errCode === 'aborted') {
            return;
          }
          if (errCode === 'no-speech') {
            // Do not abort listening on silence; onend will seamlessly restart the cycle
            return;
          }
          stopListening();
          if (
            (errCode === 'not-allowed' || errCode === 'service-not-allowed') &&
            typeof window !== 'undefined' &&
            !window.isSecureContext
          ) {
            onError?.(
              '手机浏览器限制：HTTP 局域网连接下无法调用麦克风，请使用输入法自带语音输入或切换 HTTPS 通道',
            );
            return;
          }
          onError?.(`${t.interaction.voiceUnsupported}: ${errCode}`);
        };

        recognition.onend = () => {
          if (cycleVoiceRef.current) {
            committedVoiceRef.current = mergeSpeechSegments([
              committedVoiceRef.current,
              cycleVoiceRef.current,
            ]);
            cycleVoiceRef.current = '';
          }
          if (wantListeningRef.current) {
            restartTimerRef.current = setTimeout(() => {
              if (wantListeningRef.current) {
                startCycle();
              }
            }, 120);
          } else {
            setIsListening(false);
          }
        };

        recognitionRef.current = recognition;
        recognition.start();
      } catch (err) {
        stopListening();
        onError?.((err as Error).message);
      }
    };

    startCycle();
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
      stopListening();
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
