import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Provider, SessionView } from '../shared/types.js';
import { request } from './api.js';
import { AgentLogo } from './AgentLogo.js';
import { useI18n } from './i18n/index.js';
import { playSound } from './sound.js';
import { ChatComposer, type AttachedFileItem } from './ChatComposer.js';
import styles from './Board.module.css';

export interface ProjectItem {
  id: string;
  name: string;
  path: string;
  lastUsed?: number;
  isCurrentSession?: boolean;
}

export function getPathBasename(p: string): string {
  if (!p) return '';
  const cleaned = p.trim().replace(/[/\\]+$/, '');
  const parts = cleaned.split(/[/\\]/);
  return parts[parts.length - 1] || cleaned;
}

export function normalizePath(p: string): string {
  if (!p) return '';
  return p.trim().replace(/\\\\/g, '\\').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

export function isNonProjectPath(rawPath: string): boolean {
  if (!rawPath || typeof rawPath !== 'string') return true;
  const norm = normalizePath(rawPath);
  if (!norm) return true;
  if (/^[a-z]:$/i.test(norm) || norm === '\\') return true;
  if (/^[a-z]:\\users\\[^\\]+(\\(documents|desktop|downloads|appdata))?$/i.test(norm)) {
    return true;
  }
  if (/^\\(users|home)\\[^\\]+(\\(documents|desktop|downloads))?$/i.test(norm)) {
    return true;
  }
  const blacklisted = [
    '\\documents\\codex\\',
    '\\.claude\\',
    '\\.codex\\',
    '\\.gemini\\',
    '\\.worktrees\\',
    '\\.codex-worktrees\\',
    '\\appdata\\',
    '\\node_modules\\',
    '\\temp\\',
    '\\tmp\\',
  ];
  const withTrailing = `${norm}\\`;
  for (const seg of blacklisted) {
    if (withTrailing.includes(seg)) return true;
  }
  const base = getPathBasename(norm);
  if (
    base.startsWith('.codex-') ||
    base.startsWith('.backup-worktree') ||
    base === '.claude' ||
    base === '.codex' ||
    base === '.gemini' ||
    base === '.worktrees'
  ) {
    return true;
  }
  return false;
}

export const STORAGE_PROJECTS_KEY = 'agent_board_saved_projects';
export const STORAGE_LAST_PATH_KEY = 'agent_board_last_project_path';

export interface NewSessionModalProps {
  isOpen: boolean;
  initialProvider?: Provider;
  currentSessionCwd?: string;
  allSessions?: SessionView[];
  onClose: () => void;
  onSuccess: (sessionId?: string, session?: SessionView | null, prompt?: string) => void;
}

interface CreateResult {
  ok: boolean;
  id?: string;
  nativeId?: string;
  provider: Provider;
  message?: string;
  error?: string;
  session?: SessionView | null;
}

export const AGENT_MODELS: Record<Provider, { value: string; label: string }[]> = {
  antigravity: [
    { value: 'Gemini 4 Argon', label: 'Gemini 4 Argon' },
    { value: 'Gemini 3.8 Flash', label: 'Gemini 3.8 Flash' },
    { value: 'Claude Opus 5.5', label: 'Claude Opus 5.5' },
    { value: 'Claude Sonnet 5.5', label: 'Claude Sonnet 5.5' },
    { value: 'GPT-OSS 120B (Medium)', label: 'GPT-OSS 120B (Medium)' },
  ],
  claude: [
    { value: '', label: 'Default (recommended)' },
    { value: 'opus', label: 'Opus (Opus 5.5)' },
    { value: 'fable', label: 'Fable (Fable 5.1)' },
    { value: 'sonnet', label: 'Sonnet (Sonnet 5.5)' },
    { value: 'haiku', label: 'Haiku (Haiku 5.5)' },
  ],
  codex: [
    { value: '', label: 'Default (config)' },
    { value: 'gpt-6-astra', label: 'gpt-6-astra' },
    { value: 'gpt-6.1-sol', label: 'gpt-6.1-sol' },
    { value: 'o3', label: 'o3' },
    { value: 'o3-mini', label: 'o3-mini' },
    { value: 'o1', label: 'o1' },
    { value: 'gpt-4o', label: 'gpt-4o' },
  ],
};

export function NewSessionModal({
  isOpen,
  initialProvider = 'antigravity',
  currentSessionCwd,
  allSessions,
  onClose,
  onSuccess,
}: NewSessionModalProps) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);

  const [provider, setProvider] = useState<Provider>(initialProvider);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [selectedProjectKey, setSelectedProjectKey] = useState<string>('');
  const [isCustomPath, setIsCustomPath] = useState(false);
  const [customProjectName, setCustomProjectName] = useState('');
  const [cwd, setCwd] = useState('');
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<AttachedFileItem[]>([]);
  const [title, setTitle] = useState('');
  const [model, setModel] = useState<string>('Gemini 4 Argon');
  const [availableModels, setAvailableModels] = useState<Record<Provider, { value: string; label: string }[]>>(AGENT_MODELS);
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [customModel, setCustomModel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isUploading = attachments.some((a) => a.uploading);
  const hasReadyAttachments = attachments.some((a) => !a.uploading && !a.error && a.localPath);

  const handleClose = () => {
    attachments.forEach((a) => {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      void fetch(`/api/draft/attachments/${encodeURIComponent(a.id)}`, { method: 'DELETE' }).catch(() => {});
    });
    setAttachments([]);
    onClose();
  };

  // Prefetch available models on mount so they are ready before the modal opens
  useEffect(() => {
    request<Record<Provider, { value: string; label: string }[]>>('/api/models')
      .then((data) => {
        if (data && data.antigravity && data.claude && data.codex) {
          setAvailableModels(data);
        }
      })
      .catch(() => {});
  }, []);

  // Sync initialProvider when modal opens and fetch latest dynamic models
  useEffect(() => {
    if (isOpen) {
      setProvider(initialProvider);
      setIsCustomModel(false);
      setCustomModel('');
      setModel(initialProvider === 'antigravity' ? (availableModels.antigravity[0]?.value || 'Gemini 4 Argon') : '');
      setError('');
      setPrompt('');
      setAttachments([]);
      setTitle('');

      request<Record<Provider, { value: string; label: string }[]>>('/api/models')
        .then((data) => {
          if (data && data.antigravity && data.claude && data.codex) {
            setAvailableModels(data);
            if (initialProvider === 'antigravity') {
              setModel((prev) =>
                data.antigravity.some((m) => m.value === prev)
                  ? prev
                  : data.antigravity[0]?.value || 'Gemini 4 Argon',
              );
            }
          }
        })
        .catch(() => {});
    }
  }, [isOpen, initialProvider]);

  // Load projects, auto-detect current session cwd, and merge history
  useEffect(() => {
    if (!isOpen) return;

    let localProjects: ProjectItem[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_PROJECTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          localProjects = parsed.filter((p) => p?.path && !isNonProjectPath(p.path));
        }
      }
    } catch {}

    const mergeAndApply = (
      serverProjects: ProjectItem[] = [],
      defaultCwd = '',
      fromServer = false,
    ) => {
      const projectMap = new Map<string, ProjectItem>();
      const localByNorm = new Map<string, ProjectItem>();
      for (const p of localProjects) {
        if (!p.path || isNonProjectPath(p.path)) continue;
        localByNorm.set(normalizePath(p.path), p);
      }

      if (fromServer && serverProjects.length > 0) {
        // Server has validated project markers & canonicalized paths on disk
        for (const p of serverProjects) {
          if (!p.path || isNonProjectPath(p.path)) continue;
          const norm = normalizePath(p.path);
          const local = localByNorm.get(norm);
          const base = getPathBasename(p.path);
          projectMap.set(norm, {
            id: norm,
            name:
              local?.name && local.name !== base
                ? local.name
                : p.name || base,
            path: p.path,
            lastUsed: Math.max(local?.lastUsed || 0, p.lastUsed || 0),
          });
        }
      } else {
        // Fallback when offline or in tests without /api/projects mock
        for (const p of localProjects) {
          if (!p.path || isNonProjectPath(p.path)) continue;
          const norm = normalizePath(p.path);
          projectMap.set(norm, {
            id: norm,
            name: p.name || getPathBasename(p.path),
            path: p.path,
            lastUsed: p.lastUsed || 0,
          });
        }
        if (allSessions) {
          for (const s of allSessions) {
            if (!s.cwd || typeof s.cwd !== 'string' || isNonProjectPath(s.cwd)) continue;
            const c = s.cwd.trim();
            const norm = normalizePath(c);
            if (!projectMap.has(norm)) {
              projectMap.set(norm, {
                id: norm,
                name: getPathBasename(c),
                path: c,
                lastUsed: s.updatedAt || Date.now() - 5000,
              });
            }
          }
        }
      }

      if (defaultCwd && defaultCwd.trim() && !isNonProjectPath(defaultCwd)) {
        const norm = normalizePath(defaultCwd);
        if (!projectMap.has(norm)) {
          projectMap.set(norm, {
            id: norm,
            name: getPathBasename(defaultCwd),
            path: defaultCwd,
            lastUsed: 0,
          });
        }
      }

      let matchedCurrentPath = '';
      if (currentSessionCwd && currentSessionCwd.trim() && !isNonProjectPath(currentSessionCwd)) {
        const currNorm = normalizePath(currentSessionCwd);
        let curr = projectMap.get(currNorm);
        if (!curr) {
          // Check if currentSessionCwd is a subdirectory of a known project root
          for (const [projNorm, projItem] of projectMap.entries()) {
            if (currNorm.startsWith(`${projNorm}\\`)) {
              curr = projItem;
              break;
            }
          }
        }
        if (!curr && !fromServer) {
          curr = {
            id: currNorm,
            name: getPathBasename(currentSessionCwd),
            path: currentSessionCwd.trim(),
            lastUsed: Date.now(),
          };
          projectMap.set(currNorm, curr);
        }
        if (curr) {
          curr.isCurrentSession = true;
          matchedCurrentPath = curr.path;
        }
      }

      const list = Array.from(projectMap.values());
      list.sort((a, b) => {
        if (a.isCurrentSession && !b.isCurrentSession) return -1;
        if (!a.isCurrentSession && b.isCurrentSession) return 1;
        return (b.lastUsed ?? 0) - (a.lastUsed ?? 0);
      });

      setProjects(list);

      if (fromServer && list.length > 0) {
        try {
          const toStore = list.map(({ isCurrentSession: _, ...rest }) => rest);
          localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(toStore));
        } catch {}
      }

      let targetPath = '';
      if (matchedCurrentPath) {
        targetPath = matchedCurrentPath;
      } else {
        const lastSaved = localStorage.getItem(STORAGE_LAST_PATH_KEY);
        const matchedSaved =
          lastSaved && !isNonProjectPath(lastSaved)
            ? list.find((p) => normalizePath(p.path) === normalizePath(lastSaved))
            : undefined;
        if (matchedSaved) {
          targetPath = matchedSaved.path;
        } else if (list.length > 0) {
          targetPath = list[0].path;
        } else if (defaultCwd && !isNonProjectPath(defaultCwd)) {
          targetPath = defaultCwd;
        }
      }

      if (targetPath) {
        setCwd(targetPath);
        setSelectedProjectKey(targetPath);
        setIsCustomPath(false);
        const matchedProj = list.find((p) => normalizePath(p.path) === normalizePath(targetPath));
        setCustomProjectName(matchedProj?.name || getPathBasename(targetPath));
      } else {
        setIsCustomPath(true);
        setSelectedProjectKey('__custom__');
        setCwd('');
        setCustomProjectName('');
      }
    };

    request<{ projects: ProjectItem[]; defaultCwd: string }>('/api/projects')
      .then((res) => {
        mergeAndApply(res.projects || [], res.defaultCwd, true);
      })
      .catch(() => {
        mergeAndApply([], '', false);
      });
  }, [isOpen, currentSessionCwd, allSessions]);

  // Native dialog showModal & auto focus
  useLayoutEffect(() => {
    if (isOpen && !dialog.current?.open) {
      dialog.current?.showModal();
      setTimeout(() => {
        promptInputRef.current?.focus();
      }, 50);
    } else if (!isOpen && dialog.current?.open) {
      dialog.current?.close();
    }
  }, [isOpen]);

  const handleProjectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === '__custom__') {
      setIsCustomPath(true);
      setSelectedProjectKey('__custom__');
      setCustomProjectName('');
    } else {
      setIsCustomPath(false);
      setSelectedProjectKey(val);
      setCwd(val);
      const matched = projects.find((p) => normalizePath(p.path) === normalizePath(val));
      setCustomProjectName(matched?.name || getPathBasename(val));
      try {
        localStorage.setItem(STORAGE_LAST_PATH_KEY, val);
      } catch {}
    }
  };

  const handleRemoveProject = (pathToRemove: string) => {
    const norm = normalizePath(pathToRemove);
    const updated = projects.filter((p) => normalizePath(p.path) !== norm);
    setProjects(updated);
    try {
      localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(updated));
    } catch {}
    void request('/api/projects', { projects: updated }).catch(() => {});
    if (updated.length > 0) {
      const next = updated[0];
      setCwd(next.path);
      setSelectedProjectKey(next.path);
      setIsCustomPath(false);
      setCustomProjectName(next.name || getPathBasename(next.path));
      try {
        localStorage.setItem(STORAGE_LAST_PATH_KEY, next.path);
      } catch {}
    } else {
      setIsCustomPath(true);
      setSelectedProjectKey('__custom__');
      setCwd('');
      setCustomProjectName('');
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (loading || isUploading) return;

    const trimmedPrompt = prompt.trim();
    const readyAttachments = attachments
      .filter((a) => !a.uploading && !a.error && a.localPath)
      .map((a) => ({
        id: a.id,
        name: a.name,
        size: a.size,
        mimeType: a.mimeType,
        localPath: a.localPath!,
        url: a.url!,
      }));

    if (!trimmedPrompt && readyAttachments.length === 0) {
      setError(t.newSession.promptRequiredError);
      promptInputRef.current?.focus();
      return;
    }

    setLoading(true);
    setError('');
    playSound('click');

    const finalModel = isCustomModel ? customModel.trim() : model.trim();
    const finalCwd = cwd.trim();

    try {
      const result = await request<CreateResult>('/api/sessions/create', {
        provider,
        cwd: finalCwd || undefined,
        prompt: trimmedPrompt,
        title: title.trim() || undefined,
        model: finalModel || undefined,
        launchTerminal: false,
        attachments: readyAttachments.length > 0 ? readyAttachments : undefined,
      });

      if (!result.ok) {
        throw new Error(result.error || t.newSession.errorPrefix);
      }

      // Persist chosen project
      if (finalCwd) {
        const norm = normalizePath(finalCwd);
        const existingIdx = projects.findIndex((p) => normalizePath(p.path) === norm);
        let updated: ProjectItem[];
        const pName = customProjectName.trim() || getPathBasename(finalCwd) || finalCwd;
        if (existingIdx >= 0) {
          updated = [...projects];
          updated[existingIdx] = {
            ...updated[existingIdx],
            name: isCustomPath && customProjectName.trim() ? customProjectName.trim() : updated[existingIdx].name,
            lastUsed: Date.now(),
          };
        } else {
          const newProject: ProjectItem = {
            id: norm,
            name: pName,
            path: finalCwd,
            lastUsed: Date.now(),
          };
          updated = [newProject, ...projects];
        }
        updated.sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0));
        updated = updated.slice(0, 50);
        try {
          localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(updated));
          localStorage.setItem(STORAGE_LAST_PATH_KEY, finalCwd);
        } catch {}
        void request('/api/projects', { projects: updated }).catch(() => {});
      }

      playSound('send');
      setAttachments([]);
      const optimisticPrompt =
        trimmedPrompt || readyAttachments.map((a) => `[${a.name}]`).join(' ');
      onSuccess(result.id, result.session, optimisticPrompt);
      handleClose();
    } catch (err: any) {
      setError(err?.message || t.newSession.errorPrefix);
    } finally {
      setLoading(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      className={`${styles.dialog} ${styles.newSessionModal}`}
      onCancel={handleClose}
      onClose={handleClose}
      aria-label={t.newSession.modalTitle}
    >
      {isOpen && (
        <div className={styles.newSessionContent}>
          <div className={styles.newSessionHeader}>
            <div className={styles.newSessionTitleGroup}>
              <span className={styles.newSessionHeaderIcon}>
                <AgentLogo provider={provider} size={22} />
              </span>
              <div>
                <h3>{t.newSession.modalTitle}</h3>
                <span className={styles.newSessionSubtitle}>
                  {provider === 'codex'
                    ? 'Codex CLI'
                    : provider === 'claude'
                      ? 'Claude Code'
                      : 'Antigravity'}
                </span>
              </div>
            </div>
            <button
              type="button"
              className={styles.newSessionCloseBtn}
              onClick={handleClose}
              aria-label={t.newSession.cancel}
            >
              ✕
            </button>
          </div>

          {/* Provider Switcher Tabs */}
          <div className={styles.newSessionTabs} role="tablist">
            {(['codex', 'claude', 'antigravity'] as const).map((p) => {
              const active = provider === p;
              return (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`${styles.newSessionTab} ${active ? styles.newSessionTabActive : ''} ${styles[`tab_${p}`]}`}
                  onClick={() => {
                    setProvider(p);
                    setIsCustomModel(false);
                    setCustomModel('');
                    setModel(p === 'antigravity' ? (availableModels.antigravity[0]?.value || 'Gemini 4 Argon') : '');
                    playSound('click');
                  }}
                >
                  <AgentLogo provider={p} size={15} />
                  <span>
                    {p === 'codex' ? 'Codex' : p === 'claude' ? 'Claude' : 'Antigravity'}
                  </span>
                </button>
              );
            })}
          </div>

          <form onSubmit={handleSubmit} className={styles.newSessionForm}>
            {/* Project / Working Directory */}
            <div className={styles.newSessionField}>
              <label htmlFor="new-session-project-select" className={styles.newSessionLabel}>
                <span>📁 {t.newSession.projectLabel}</span>
              </label>

              <div className={styles.newSessionProjectSelectGroup}>
                <select
                  id="new-session-project-select"
                  className={styles.newSessionSelect}
                  value={isCustomPath ? '__custom__' : selectedProjectKey}
                  onChange={handleProjectChange}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.path}>
                      {p.isCurrentSession ? '✨ ' : '📁 '}
                      {p.name} ({p.path})
                      {p.isCurrentSession ? ` ${t.newSession.currentSessionBadge}` : ''}
                    </option>
                  ))}
                  <option value="__custom__">{t.newSession.customPathOption}</option>
                </select>

                {!isCustomPath && cwd && (
                  <div className={styles.newSessionProjectDetail}>
                    <input type="hidden" id="new-session-cwd" value={cwd} />
                    <span className={styles.newSessionProjectPath} title={cwd}>
                      📁 <code>{cwd}</code>
                    </span>
                    <div className={styles.newSessionProjectActions}>
                      <button
                        type="button"
                        className={styles.newSessionProjectBtn}
                        onClick={() => setIsCustomPath(true)}
                        title={t.newSession.editOrEnterPath}
                      >
                        ✏️ {t.newSession.manualEdit}
                      </button>
                      <button
                        type="button"
                        className={styles.newSessionProjectBtnDanger}
                        onClick={() => handleRemoveProject(cwd)}
                        title={t.newSession.removeFromHistory}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                )}

                {isCustomPath && (
                  <div className={styles.newSessionCustomPathBox}>
                    <input
                      id="new-session-cwd"
                      type="text"
                      className={styles.newSessionInput}
                      value={cwd}
                      onChange={(e) => {
                        const nextVal = e.target.value;
                        setCwd(nextVal);
                        if (!customProjectName || customProjectName === getPathBasename(cwd)) {
                          setCustomProjectName(getPathBasename(nextVal));
                        }
                      }}
                      placeholder={t.newSession.cwdPlaceholder}
                      autoComplete="off"
                      spellCheck={false}
                      autoFocus
                    />
                    <div className={styles.newSessionCustomNameRow}>
                      <input
                        type="text"
                        className={styles.newSessionInputSmall}
                        value={customProjectName}
                        onChange={(e) => setCustomProjectName(e.target.value)}
                        placeholder={t.newSession.projectNamePlaceholder}
                        title={t.newSession.projectNameLabel}
                      />
                      {projects.length > 0 && (
                        <button
                          type="button"
                          className={styles.newSessionProjectBtn}
                          onClick={() => {
                            setIsCustomPath(false);
                            if (projects.length > 0) {
                              const first = projects.find((p) => p.isCurrentSession) || projects[0];
                              setSelectedProjectKey(first.path);
                              setCwd(first.path);
                              setCustomProjectName(first.name);
                            }
                          }}
                        >
                          ↩ {t.newSession.backToSelectList}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <span className={styles.newSessionHelp}>{t.newSession.cwdHelp}</span>
            </div>

            {/* Prompt */}
            <div className={styles.newSessionField}>
              <label htmlFor="new-session-prompt" className={styles.newSessionLabel}>
                <span>💬 {t.newSession.promptLabel}</span>
                <span className={styles.requiredMark}>*</span>
              </label>
              <ChatComposer
                id="new-session-prompt"
                inputRef={promptInputRef}
                value={prompt}
                onChange={(val) => {
                  setPrompt(val);
                  if (error) setError('');
                }}
                attachments={attachments}
                onAttachmentsChange={setAttachments}
                onSubmit={() => void handleSubmit()}
                submitOnEnter={true}
                placeholder={t.newSession.promptPlaceholder}
                ariaLabel={t.newSession.promptLabel}
                onError={setError}
                disabled={loading}
                rows={3}
                hint={t.interaction.composerHint}
              />
            </div>

            {/* Options Grid: Model & Title */}
            <div className={styles.newSessionGrid2}>
              {/* Model Selection according to actual Agent */}
              <div className={styles.newSessionField}>
                <label htmlFor="new-session-model" className={styles.newSessionLabel}>
                  <span>⚡ {t.newSession.modelLabel}</span>
                </label>
                <div className={styles.newSessionModelGroup}>
                  <select
                    id="new-session-model"
                    className={styles.newSessionSelect}
                    value={isCustomModel ? '__custom__' : model}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setIsCustomModel(true);
                      } else {
                        setIsCustomModel(false);
                        setModel(e.target.value);
                      }
                    }}
                  >
                    {(availableModels[provider] || AGENT_MODELS[provider]).map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                    <option value="__custom__">Custom model...</option>
                  </select>
                  {isCustomModel && (
                    <input
                      type="text"
                      className={styles.newSessionInput}
                      placeholder="Enter model name..."
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                      autoFocus
                    />
                  )}
                </div>
              </div>

              {/* Title (Optional) */}
              <div className={styles.newSessionField}>
                <label htmlFor="new-session-title" className={styles.newSessionLabel}>
                  <span>🏷️ {t.newSession.titleLabel}</span>
                </label>
                <input
                  id="new-session-title"
                  type="text"
                  className={styles.newSessionInput}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t.newSession.titlePlaceholder}
                  autoComplete="off"
                />
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className={styles.newSessionError} role="alert">
                <span>⚠️ {error}</span>
              </div>
            )}

            {/* Actions */}
            <div className={styles.newSessionActions}>
              <button
                type="button"
                className={styles.newSessionCancelBtn}
                onClick={handleClose}
                disabled={loading}
              >
                {t.newSession.cancel}
              </button>
              <button
                type="submit"
                className={styles.newSessionSubmitBtn}
                disabled={loading || isUploading || (!prompt.trim() && !hasReadyAttachments)}
              >
                {loading ? t.newSession.creating : isUploading ? t.interaction.uploading : t.newSession.create}
              </button>
            </div>
          </form>
        </div>
      )}
    </dialog>
  );
}
