import React, { useEffect, useMemo, useState } from 'react';
import {
  SavedFormAnswer,
  SavedFormAnswerControlKind,
  SavedFormAnswerSafetyCategory,
  createSavedFormAnswer,
  deleteSavedFormAnswer,
  listSavedFormAnswers,
  updateSavedFormAnswer
} from '../services/savedFormAnswerService';

const CONTROL_KIND_OPTIONS: SavedFormAnswerControlKind[] = [
  'text',
  'textarea',
  'select',
  'checkbox',
  'radio',
  'unknown'
];

const SAFETY_CATEGORY_OPTIONS: SavedFormAnswerSafetyCategory[] = [
  'safe',
  'legal',
  'work_rights',
  'salary',
  'demographic',
  'availability',
  'certification',
  'degree',
  'clearance',
  'reference',
  'uncertain',
  'unsupported'
];

const SENSITIVE_CATEGORIES = new Set<SavedFormAnswerSafetyCategory>(
  SAFETY_CATEGORY_OPTIONS.filter(category => category !== 'safe')
);

const formatLabel = (value: string): string =>
  value.replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());

const createEmptyDraft = () => ({
  id: '',
  question: '',
  answer: '',
  controlKind: 'text' as SavedFormAnswerControlKind,
  safetyCategory: 'safe' as SavedFormAnswerSafetyCategory,
  explicitlyApproved: true,
  allowAutoReuse: true
});

const clearDraft = () => createEmptyDraft();

const SavedFormAnswersManager: React.FC = () => {
  const [savedAnswers, setSavedAnswers] = useState<SavedFormAnswer[]>([]);
  const [draft, setDraft] = useState(createEmptyDraft);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const isSensitiveDraft = SENSITIVE_CATEGORIES.has(draft.safetyCategory);
  const safeSavedCount = useMemo(
    () => savedAnswers.filter(answer => answer.allowAutoReuse).length,
    [savedAnswers]
  );

  const loadSavedAnswers = async (): Promise<void> => {
    setIsLoading(true);
    try {
      setSavedAnswers(await listSavedFormAnswers());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load saved answers');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadSavedAnswers();
  }, []);

  const resetDraft = (): void => {
    setDraft(createEmptyDraft());
    setMessage(null);
    setError(null);
  };

  const editAnswer = (answer: SavedFormAnswer): void => {
    setDraft({
      id: answer.id,
      question: answer.question,
      answer: answer.answer,
      controlKind: answer.controlKind,
      safetyCategory: answer.safetyCategory,
      explicitlyApproved: answer.explicitlyApproved,
      allowAutoReuse: answer.allowAutoReuse
    });
    setMessage(null);
    setError(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const payload = {
        question: draft.question,
        answer: draft.answer,
        controlKind: draft.controlKind,
        safetyCategory: draft.safetyCategory,
        explicitlyApproved: draft.explicitlyApproved,
        allowAutoReuse: isSensitiveDraft ? false : draft.allowAutoReuse
      };

      if (draft.id) {
        await updateSavedFormAnswer(draft.id, payload);
        setMessage('Saved answer updated.');
      } else {
        await createSavedFormAnswer(payload);
        setMessage('Saved answer added.');
      }

      setDraft(clearDraft());
      await loadSavedAnswers();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save answer');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (answerId: string): Promise<void> => {
    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      await deleteSavedFormAnswer(answerId);
      if (draft.id === answerId) {
        resetDraft();
      }
      await loadSavedAnswers();
      setMessage('Saved answer deleted.');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete answer');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="application-profile-section saved-answers-section">
      <div className="application-profile-header">
        <div>
          <h2>Saved Application Answers</h2>
          <p className="application-profile-description">
            Review approved answers for repeated application questions. Sensitive answers stay manual
            approval only.
          </p>
        </div>
        <span className="application-profile-badge">
          {safeSavedCount} auto-reuse ready
        </span>
      </div>

      {(error || message) && (
        <p className={error ? 'application-detail-error' : 'application-profile-fill-message'}>
          {error || message}
        </p>
      )}

      <form className="saved-answer-editor" onSubmit={event => void handleSubmit(event)}>
        <label className="application-profile-field application-profile-field-wide">
          <span>Question</span>
          <input
            type="text"
            required
            value={draft.question}
            onChange={event => setDraft(current => ({ ...current, question: event.target.value }))}
          />
        </label>

        <label className="application-profile-field application-profile-field-wide">
          <span>Answer</span>
          <textarea
            rows={4}
            required
            value={draft.answer}
            onChange={event => setDraft(current => ({ ...current, answer: event.target.value }))}
          />
        </label>

        <label className="application-profile-field">
          <span>Control type</span>
          <select
            value={draft.controlKind}
            onChange={event =>
              setDraft(current => ({
                ...current,
                controlKind: event.target.value as SavedFormAnswerControlKind
              }))
            }
          >
            {CONTROL_KIND_OPTIONS.map(kind => (
              <option key={kind} value={kind}>
                {formatLabel(kind)}
              </option>
            ))}
          </select>
        </label>

        <label className="application-profile-field">
          <span>Safety category</span>
          <select
            value={draft.safetyCategory}
            onChange={event =>
              setDraft(current => ({
                ...current,
                safetyCategory: event.target.value as SavedFormAnswerSafetyCategory,
                allowAutoReuse:
                  event.target.value === 'safe' ? current.allowAutoReuse : false
              }))
            }
          >
            {SAFETY_CATEGORY_OPTIONS.map(category => (
              <option key={category} value={category}>
                {formatLabel(category)}
              </option>
            ))}
          </select>
        </label>

        <label className="saved-answer-checkbox">
          <input
            type="checkbox"
            checked={draft.explicitlyApproved}
            onChange={event =>
              setDraft(current => ({ ...current, explicitlyApproved: event.target.checked }))
            }
          />
          <span>Approved by me</span>
        </label>

        <label className="saved-answer-checkbox">
          <input
            type="checkbox"
            disabled={isSensitiveDraft}
            checked={!isSensitiveDraft && draft.allowAutoReuse}
            onChange={event =>
              setDraft(current => ({ ...current, allowAutoReuse: event.target.checked }))
            }
          />
          <span>{isSensitiveDraft ? 'Manual approval required for reuse' : 'Allow automatic reuse'}</span>
        </label>

        <div className="saved-answer-editor-actions">
          <button type="submit" disabled={isSaving}>
            {isSaving ? 'Saving...' : draft.id ? 'Update Answer' : 'Add Answer'}
          </button>
          {draft.id && (
            <button type="button" className="secondary-button" onClick={resetDraft}>
              Cancel Edit
            </button>
          )}
        </div>
      </form>

      <div className="saved-answer-list">
        {isLoading ? (
          <p className="application-profile-description">Loading saved answers...</p>
        ) : savedAnswers.length === 0 ? (
          <p className="application-profile-description">No saved answers yet.</p>
        ) : (
          savedAnswers.map(answer => (
            <article key={answer.id} className="saved-answer-row">
              <div>
                <div className="saved-answer-row-title">
                  <strong>{answer.question}</strong>
                  <span className={answer.allowAutoReuse ? 'safe' : 'manual'}>
                    {answer.allowAutoReuse ? 'Auto reuse' : 'Manual approval'}
                  </span>
                </div>
                <p>{answer.answer}</p>
                <small>
                  {formatLabel(answer.controlKind)} | {formatLabel(answer.safetyCategory)}
                </small>
              </div>
              <div className="saved-answer-row-actions">
                <button type="button" onClick={() => editAnswer(answer)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="danger-button"
                  disabled={isSaving}
                  onClick={() => void handleDelete(answer.id)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
};

export default SavedFormAnswersManager;
