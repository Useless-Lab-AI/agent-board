import { useEffect, useRef, useState } from 'react';
import type { InteractionQuestion, InteractionRequest } from '../shared/interaction.js';
import { useI18n } from './i18n/index.js';
import { playSound } from './sound.js';
import styles from './Board.module.css';

export interface QuestionDecisionDetail {
  selectedOptions?: string[];
  writeIn?: string;
  skipped?: boolean;
}

export interface QuestionDecisionPayload {
  providerRequestId: string;
  action: 'submit' | 'skip' | 'cancel';
  answers: Record<string, string>;
  questionDetails: Record<string, QuestionDecisionDetail>;
}

interface QuestionDraft {
  selectedOptions: string[];
  otherSelected: boolean;
  otherText: string;
  skipped: boolean;
}

function getDefaultDraft(): QuestionDraft {
  return {
    selectedOptions: [],
    otherSelected: false,
    otherText: '',
    skipped: false,
  };
}

function isQuestionAnswered(q: InteractionQuestion, d: QuestionDraft): boolean {
  if (q.options.length === 0) {
    return d.otherText.trim().length > 0;
  }
  if (!q.multiple) {
    if (d.otherSelected) {
      return d.otherText.trim().length > 0;
    }
    return d.selectedOptions.length === 1;
  }
  // Multi-select
  if (d.otherSelected && d.otherText.trim().length === 0 && d.selectedOptions.length === 0) {
    return false;
  }
  return d.selectedOptions.length > 0 || (d.otherSelected && d.otherText.trim().length > 0);
}

function buildQuestionAnswerString(q: InteractionQuestion, d: QuestionDraft): string {
  if (d.skipped) return '(Skipped)';
  if (q.options.length === 0) return d.otherText.trim();
  if (!q.multiple) {
    return d.otherSelected ? d.otherText.trim() : (d.selectedOptions[0] ?? '');
  }
  const parts = [...d.selectedOptions];
  if (d.otherSelected && d.otherText.trim()) {
    parts.push(d.otherText.trim());
  }
  return parts.join(', ');
}

export function InteractiveQuestionCard({
  request,
  disabled = false,
  onSubmit,
}: {
  request: InteractionRequest;
  disabled?: boolean;
  onSubmit: (payload: QuestionDecisionPayload) => void;
}) {
  const { t, tr } = useI18n();
  const questions = request.questions ?? [];
  const [stepIndex, setStepIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({});
  const otherInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setStepIndex(0);
    setDrafts({});
  }, [request.id]);

  const safeIndex = Math.min(Math.max(0, stepIndex), Math.max(0, questions.length - 1));
  const currentQ = questions[safeIndex];

  useEffect(() => {
    if (!currentQ) return;
    const d = drafts[currentQ.id] ?? getDefaultDraft();
    if (d.otherSelected || currentQ.options.length === 0) {
      otherInputRef.current?.focus();
    }
  }, [currentQ, drafts]);

  if (!currentQ) return null;

  const curDraft = drafts[currentQ.id] ?? getDefaultDraft();
  const currentAnswered = isQuestionAnswered(currentQ, curDraft);

  const updateCurrentDraft = (updater: (prev: QuestionDraft) => QuestionDraft) => {
    setDrafts((prev) => {
      const existing = prev[currentQ.id] ?? getDefaultDraft();
      return {
        ...prev,
        [currentQ.id]: updater(existing),
      };
    });
  };

  const finalizeSubmit = (nextDrafts: Record<string, QuestionDraft>) => {
    const answers: Record<string, string> = {};
    const questionDetails: Record<string, QuestionDecisionDetail> = {};
    let allSkipped = true;

    for (const q of questions) {
      const d = nextDrafts[q.id] ?? getDefaultDraft();
      const ans = buildQuestionAnswerString(q, d);
      answers[q.id] = ans || '(Skipped)';
      if (d.skipped || !ans) {
        questionDetails[q.id] = { skipped: true };
      } else {
        allSkipped = false;
        questionDetails[q.id] = {
          selectedOptions: d.otherSelected && !q.multiple ? [] : d.selectedOptions,
          writeIn:
            q.options.length === 0 || d.otherSelected ? d.otherText.trim() : '',
          skipped: false,
        };
      }
    }

    onSubmit({
      providerRequestId: request.id,
      action: allSkipped ? 'skip' : 'submit',
      answers,
      questionDetails,
    });
  };

  const handleContinue = () => {
    if (disabled || !currentAnswered) return;
    playSound('approve');
    const nextDrafts: Record<string, QuestionDraft> = {
      ...drafts,
      [currentQ.id]: { ...curDraft, skipped: false },
    };
    setDrafts(nextDrafts);

    if (safeIndex < questions.length - 1) {
      setStepIndex(safeIndex + 1);
      return;
    }

    // Check if any earlier question is still unanswered and not skipped
    const firstIncompleteIdx = questions.findIndex((q) => {
      const d = nextDrafts[q.id] ?? getDefaultDraft();
      return !d.skipped && !isQuestionAnswered(q, d);
    });
    if (firstIncompleteIdx !== -1 && firstIncompleteIdx !== safeIndex) {
      setStepIndex(firstIncompleteIdx);
      return;
    }

    finalizeSubmit(nextDrafts);
  };

  const handleSkip = () => {
    if (disabled) return;
    playSound('click');
    const nextDrafts: Record<string, QuestionDraft> = {
      ...drafts,
      [currentQ.id]: {
        selectedOptions: [],
        otherSelected: false,
        otherText: '',
        skipped: true,
      },
    };
    setDrafts(nextDrafts);

    if (safeIndex < questions.length - 1) {
      setStepIndex(safeIndex + 1);
      return;
    }

    const firstIncompleteIdx = questions.findIndex((q) => {
      const d = nextDrafts[q.id] ?? getDefaultDraft();
      return !d.skipped && !isQuestionAnswered(q, d);
    });
    if (firstIncompleteIdx !== -1 && firstIncompleteIdx !== safeIndex) {
      setStepIndex(firstIncompleteIdx);
      return;
    }

    finalizeSubmit(nextDrafts);
  };

  const handleCancel = () => {
    if (disabled) return;
    playSound('click');
    onSubmit({
      providerRequestId: request.id,
      action: 'cancel',
      answers: {},
      questionDetails: {},
    });
  };

  const handleSelectOption = (opt: string) => {
    if (disabled) return;
    playSound('click');
    updateCurrentDraft((prev) => {
      if (!currentQ.multiple) {
        return {
          ...prev,
          selectedOptions: [opt],
          otherSelected: false,
          skipped: false,
        };
      }
      const exists = prev.selectedOptions.includes(opt);
      const nextSelected = exists
        ? prev.selectedOptions.filter((x) => x !== opt)
        : [...prev.selectedOptions, opt];
      return {
        ...prev,
        selectedOptions: nextSelected,
        skipped: false,
      };
    });
  };

  const handleSelectOther = () => {
    if (disabled) return;
    playSound('click');
    updateCurrentDraft((prev) => {
      if (!currentQ.multiple) {
        return {
          ...prev,
          selectedOptions: [],
          otherSelected: true,
          skipped: false,
        };
      }
      return {
        ...prev,
        otherSelected: !prev.otherSelected,
        skipped: false,
      };
    });
  };

  return (
    <div
      className={styles.nativeQuestionContainer}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && currentAnswered && !disabled) {
          e.preventDefault();
          handleContinue();
        }
      }}
    >
      <div className={styles.nativeQuestionStatusRow}>
        <span className={styles.nativeQuestionStatusLeft}>
          {t.interaction.askingQuestions(questions.length)}
          {request.title && request.title !== 'AI 需要你的回答'
            ? ` · ${tr(request.title)}`
            : ''}
        </span>
        <span className={styles.nativeQuestionStatusRight}>
          {t.interaction.waitingForUserInput}
        </span>
      </div>

      <div className={styles.nativeQuestionCard}>
        <div className={styles.nativeQuestionHeader}>
          <div className={styles.nativeQuestionTitleWrap}>
            <span className={styles.nativeQuestionBadge} aria-hidden="true">
              ?
            </span>
            <span className={styles.nativeQuestionTitle}>
              {currentQ.text}
              {currentQ.multiple && (
                <small className={styles.nativeQuestionMultiHint}>
                  {t.interaction.multipleAllowed}
                </small>
              )}
            </span>
          </div>

          {questions.length > 1 && (
            <div className={styles.nativeQuestionPager}>
              <button
                type="button"
                className={styles.nativeQuestionPagerBtn}
                disabled={safeIndex === 0 || disabled}
                onClick={() => {
                  playSound('click');
                  setStepIndex((i) => Math.max(0, i - 1));
                }}
                aria-label={t.interaction.prevQuestion}
                title={t.interaction.prevQuestion}
              >
                ←
              </button>
              <span className={styles.nativeQuestionPagerText}>
                {t.interaction.questionStepOf(safeIndex + 1, questions.length)}
              </span>
              <button
                type="button"
                className={styles.nativeQuestionPagerBtn}
                disabled={safeIndex >= questions.length - 1 || disabled}
                onClick={() => {
                  playSound('click');
                  setStepIndex((i) => Math.min(questions.length - 1, i + 1));
                }}
                aria-label={t.interaction.nextQuestion}
                title={t.interaction.nextQuestion}
              >
                →
              </button>
            </div>
          )}
        </div>

        <div className={styles.nativeQuestionOptions} role="group" aria-label={currentQ.text}>
          {currentQ.options.map((opt, idx) => {
            const isSelected =
              !curDraft.skipped &&
              (!currentQ.multiple
                ? !curDraft.otherSelected && curDraft.selectedOptions[0] === opt
                : curDraft.selectedOptions.includes(opt));
            return (
              <button
                key={`${idx}-${opt}`}
                type="button"
                className={styles.nativeQuestionOptionRow}
                data-selected={isSelected}
                disabled={disabled}
                onClick={() => handleSelectOption(opt)}
              >
                <span className={styles.nativeQuestionOptNum} data-selected={isSelected}>
                  {idx + 1}
                </span>
                <span className={styles.nativeQuestionOptText}>{opt}</span>
                {isSelected && (
                  <span className={styles.nativeQuestionOptCheck} aria-hidden="true">
                    ✓
                  </span>
                )}
              </button>
            );
          })}

          {currentQ.options.length > 0 ? (
            <div
              className={styles.nativeQuestionOtherWrap}
              data-selected={curDraft.otherSelected}
            >
              <button
                type="button"
                className={styles.nativeQuestionOptionRow}
                data-selected={curDraft.otherSelected}
                disabled={disabled}
                onClick={handleSelectOther}
              >
                <span
                  className={styles.nativeQuestionOptNum}
                  data-selected={curDraft.otherSelected}
                >
                  {currentQ.options.length + 1}
                </span>
                <span className={styles.nativeQuestionOptText}>
                  {t.interaction.otherWriteInOption}
                </span>
                {curDraft.otherSelected && (
                  <span className={styles.nativeQuestionOptCheck} aria-hidden="true">
                    ✓
                  </span>
                )}
              </button>
              {curDraft.otherSelected && (
                <div className={styles.nativeQuestionWriteInBox}>
                  <input
                    ref={otherInputRef}
                    type="text"
                    className={styles.nativeQuestionWriteInInput}
                    placeholder={t.interaction.otherWriteInPlaceholder}
                    value={curDraft.otherText}
                    disabled={disabled}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateCurrentDraft((prev) => ({
                        ...prev,
                        otherSelected: true,
                        otherText: val,
                        skipped: false,
                      }));
                    }}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className={styles.nativeQuestionWriteInBox}>
              <input
                ref={otherInputRef}
                type="text"
                className={styles.nativeQuestionWriteInInput}
                placeholder={t.interaction.otherWriteInPlaceholder}
                value={curDraft.otherText}
                disabled={disabled}
                onChange={(e) => {
                  const val = e.target.value;
                  updateCurrentDraft((prev) => ({
                    ...prev,
                    otherSelected: true,
                    otherText: val,
                    skipped: false,
                  }));
                }}
              />
            </div>
          )}
        </div>

        <div className={styles.nativeQuestionFooter}>
          <button
            type="button"
            className={styles.nativeQuestionCancelBtn}
            disabled={disabled}
            onClick={handleCancel}
          >
            {t.interaction.cancelQuestion}
          </button>

          <div className={styles.nativeQuestionFooterRight}>
            <button
              type="button"
              className={styles.nativeQuestionSkipBtn}
              disabled={disabled}
              onClick={handleSkip}
            >
              {t.interaction.skipQuestion}
            </button>
            <button
              type="button"
              className={styles.nativeQuestionContinueBtn}
              disabled={disabled || !currentAnswered}
              onClick={handleContinue}
            >
              {t.interaction.continueQuestion} <span aria-hidden="true">↵</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
