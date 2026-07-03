import React, { useEffect, useMemo, useState } from 'react';
import {
  HumanInterventionAction,
  HumanInterventionRecord,
  fetchPendingHumanInterventions,
  getHumanInterventionArtifactUrl,
  getHumanInterventionScreenshotUrl,
  resolveHumanIntervention
} from '../services/humanInterventionApi';
import {
  SavedFormAnswer,
  SavedFormAnswerControlKind,
  SavedFormAnswerSafetyCategory,
  createSavedFormAnswer,
  listSavedFormAnswers,
  updateSavedFormAnswer
} from '../services/savedFormAnswerService';

interface HumanInterventionPanelProps {
  onResolved?: () => Promise<void>;
}

const POLL_INTERVAL_MS = 4000;

const REASON_LABELS: Record<HumanInterventionRecord['reason'], string> = {
  final_submission_approval: 'Final Submission Approval',
  captcha: 'Captcha',
  mfa: 'MFA',
  missing_information: 'Missing Information',
  unsupported_declaration: 'Unsupported Declaration',
  manual_review: 'Manual Review',
  unknown: 'Unknown'
};

const ACTION_LABELS: Record<HumanInterventionAction, string> = {
  continued: 'Continue Bot',
  skipped: 'Skip Application',
  failed: 'Mark Failed'
};

const ACTION_CLASS_NAMES: Record<HumanInterventionAction, string> = {
  continued: 'continue',
  skipped: 'skip',
  failed: 'fail'
};

const SENSITIVE_SAVED_ANSWER_CATEGORIES = new Set<SavedFormAnswerSafetyCategory>([
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
]);

interface HumanReviewField {
  controlIndex: number;
  question: string;
  controlKind: SavedFormAnswerControlKind;
  safetyCategory: SavedFormAnswerSafetyCategory;
  reason?: string;
  savedFormAnswerId?: string;
}

interface SavedAnswerSuggestion {
  controlIndex: number;
  question: string;
  controlKind: SavedFormAnswerControlKind;
  answer: string;
  safetyCategory: SavedFormAnswerSafetyCategory;
  savedFormAnswerId?: string;
  reason?: string;
}

interface AnswerDraft {
  answer: string;
  saveForFuture: boolean;
  allowAutoReuse: boolean;
  savedFormAnswerId?: string;
}

interface ApprovedAnswerPayload {
  controlIndex: number;
  question: string;
  answer: string;
  controlKind: SavedFormAnswerControlKind;
  safetyCategory: SavedFormAnswerSafetyCategory;
  savedFormAnswerId?: string;
}

interface InterventionAnswerResult {
  savedCount: number;
  approvedAnswers: ApprovedAnswerPayload[];
}

const readMetadataText = (
  metadata: Record<string, unknown> | undefined,
  keys: string[]
): string | undefined => {
  if (!metadata) {
    return undefined;
  }

  for (const key of keys) {
    const value = metadata[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nestedValue = readMetadataText(value as Record<string, unknown>, keys);
      if (nestedValue) {
        return nestedValue;
      }
    }
  }

  return undefined;
};

const formatTimestamp = (value: string): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));

const getCompanyLabel = (intervention: HumanInterventionRecord): string =>
  readMetadataText(intervention.metadata, [
    'company',
    'companyName',
    'jobCompany',
    'employer',
    'employerName'
  ]) || 'Unknown company';

const getRoleLabel = (intervention: HumanInterventionRecord): string =>
  readMetadataText(intervention.metadata, [
    'role',
    'roleTitle',
    'jobTitle',
    'position',
    'positionTitle',
    'title'
  ]) || intervention.title;

const getArtifactLabel = (kind: string, label?: string): string =>
  (label || kind)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, character => character.toUpperCase());

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const readHumanReviewFields = (
  metadata: Record<string, unknown> | undefined
): HumanReviewField[] => {
  const fields = metadata?.humanReviewFields;
  if (!Array.isArray(fields)) {
    return [];
  }

  return fields.filter(isRecord).map((field, index) => ({
    controlIndex: typeof field.controlIndex === 'number' ? field.controlIndex : index,
    question: typeof field.question === 'string' ? field.question : 'Application question',
    controlKind:
      typeof field.controlKind === 'string'
        ? (field.controlKind as SavedFormAnswerControlKind)
        : 'unknown',
    safetyCategory:
      typeof field.safetyCategory === 'string'
        ? (field.safetyCategory as SavedFormAnswerSafetyCategory)
        : 'uncertain',
    reason: typeof field.reason === 'string' ? field.reason : undefined,
    savedFormAnswerId:
      typeof field.savedFormAnswerId === 'string' ? field.savedFormAnswerId : undefined
  }));
};

const readSavedAnswerSuggestions = (
  metadata: Record<string, unknown> | undefined
): SavedAnswerSuggestion[] => {
  const suggestions = metadata?.savedAnswerSuggestions;
  if (!Array.isArray(suggestions)) {
    return [];
  }

  return suggestions.filter(isRecord).map((suggestion, index) => ({
    controlIndex: typeof suggestion.controlIndex === 'number' ? suggestion.controlIndex : index,
    question: typeof suggestion.question === 'string' ? suggestion.question : 'Application question',
    controlKind:
      typeof suggestion.controlKind === 'string'
        ? (suggestion.controlKind as SavedFormAnswerControlKind)
        : 'unknown',
    answer: typeof suggestion.answer === 'string' ? suggestion.answer : '',
    safetyCategory:
      typeof suggestion.safetyCategory === 'string'
        ? (suggestion.safetyCategory as SavedFormAnswerSafetyCategory)
        : 'safe',
    savedFormAnswerId:
      typeof suggestion.savedFormAnswerId === 'string' ? suggestion.savedFormAnswerId : undefined,
    reason: typeof suggestion.reason === 'string' ? suggestion.reason : undefined
  }));
};

const normalizeQuestion = (value: string): string =>
  value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getSimilarity = (left: string, right: string): number => {
  const leftTokens = Array.from(new Set(normalizeQuestion(left).split(' ').filter(Boolean)));
  const rightTokens = Array.from(new Set(normalizeQuestion(right).split(' ').filter(Boolean)));
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const rightSet = new Set(rightTokens);
  const shared = leftTokens.filter(token => rightSet.has(token)).length;
  return shared / new Set([...leftTokens, ...rightTokens]).size;
};

const findSavedAnswerSuggestion = (
  field: HumanReviewField,
  savedAnswers: SavedFormAnswer[]
): SavedFormAnswer | undefined =>
  savedAnswers
    .map(answer => ({
      answer,
      score: getSimilarity(field.question, answer.question)
    }))
    .filter(candidate => candidate.score >= 0.8)
    .sort((left, right) => right.score - left.score)[0]?.answer;

const getFieldKey = (interventionId: string, field: HumanReviewField): string =>
  `${interventionId}:${field.controlIndex}:${field.question}`;

const formatCategory = (value: string): string =>
  value.replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());

const HumanInterventionPanel: React.FC<HumanInterventionPanelProps> = ({ onResolved }) => {
  const [interventions, setInterventions] = useState<HumanInterventionRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<{
    interventionId: string;
    action: HumanInterventionAction;
  } | null>(null);
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});
  const [savedAnswers, setSavedAnswers] = useState<SavedFormAnswer[]>([]);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, AnswerDraft>>({});
  const hasPendingInterventions = interventions.length > 0;
  const pendingCountLabel = useMemo(
    () =>
      interventions.length === 1
        ? '1 handoff waiting'
        : `${interventions.length} handoffs waiting`,
    [interventions.length]
  );

  const loadPendingInterventions = async (showLoading: boolean = false): Promise<void> => {
    if (showLoading) {
      setIsLoading(true);
    }

    try {
      const pendingInterventions = await fetchPendingHumanInterventions();
      setInterventions(pendingInterventions);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load pending automation handoffs'
      );
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    let isMounted = true;

    const pollPendingInterventions = async (showLoading: boolean = false): Promise<void> => {
      if (showLoading) {
        setIsLoading(true);
      }

      try {
        const pendingInterventions = await fetchPendingHumanInterventions();
        if (!isMounted) {
          return;
        }

        setInterventions(pendingInterventions);
        setError(null);
      } catch (loadError) {
        if (!isMounted) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load pending automation handoffs'
        );
      } finally {
        if (showLoading && isMounted) {
          setIsLoading(false);
        }
      }
    };

    void pollPendingInterventions(true);
    const intervalId = window.setInterval(() => {
      void pollPendingInterventions();
    }, POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!hasPendingInterventions) {
      return;
    }

    void listSavedFormAnswers()
      .then(setSavedAnswers)
      .catch(loadError => {
        setError(
          loadError instanceof Error ? loadError.message : 'Failed to load saved answers'
        );
      });
  }, [hasPendingInterventions]);

  useEffect(() => {
    setAnswerDrafts(currentDrafts => {
      const nextDrafts = { ...currentDrafts };

      interventions.forEach(intervention => {
        readHumanReviewFields(intervention.metadata).forEach(field => {
          const fieldKey = getFieldKey(intervention.id, field);
          if (nextDrafts[fieldKey]) {
            return;
          }

          const suggestion = findSavedAnswerSuggestion(field, savedAnswers);
          nextDrafts[fieldKey] = {
            answer: suggestion?.answer || '',
            saveForFuture: false,
            allowAutoReuse: field.safetyCategory === 'safe',
            savedFormAnswerId: suggestion?.id
          };
        });
      });

      return nextDrafts;
    });
  }, [interventions, savedAnswers]);

  const updateAnswerDraft = (
    fieldKey: string,
    updates: Partial<AnswerDraft>
  ): void => {
    setAnswerDrafts(currentDrafts => ({
      ...currentDrafts,
      [fieldKey]: {
        ...(currentDrafts[fieldKey] || {
          answer: '',
          saveForFuture: false,
          allowAutoReuse: false
        }),
        ...updates
      }
    }));
  };

  const saveInterventionAnswers = async (
    intervention: HumanInterventionRecord
  ): Promise<InterventionAnswerResult> => {
    let savedCount = 0;
    const approvedAnswers: ApprovedAnswerPayload[] = [];
    const fields = readHumanReviewFields(intervention.metadata);

    for (const field of fields) {
      const fieldKey = getFieldKey(intervention.id, field);
      const draft = answerDrafts[fieldKey];
      const answer = draft?.answer.trim() || '';
      if (!answer) {
        continue;
      }

      approvedAnswers.push({
        controlIndex: field.controlIndex,
        question: field.question,
        answer,
        controlKind: field.controlKind,
        safetyCategory: field.safetyCategory,
        savedFormAnswerId: draft?.savedFormAnswerId
      });

      if (!draft?.saveForFuture) {
        continue;
      }

      const isSensitive = SENSITIVE_SAVED_ANSWER_CATEGORIES.has(field.safetyCategory);
      const input = {
        question: field.question,
        answer,
        controlKind: field.controlKind,
        safetyCategory: field.safetyCategory,
        explicitlyApproved: true,
        allowAutoReuse: isSensitive ? false : draft.allowAutoReuse
      };

      if (draft.savedFormAnswerId) {
        await updateSavedFormAnswer(draft.savedFormAnswerId, input);
      } else {
        await createSavedFormAnswer(input);
      }

      savedCount += 1;
    }

    if (savedCount > 0) {
      setSavedAnswers(await listSavedFormAnswers());
    }

    return { savedCount, approvedAnswers };
  };

  const handleAction = async (
    interventionId: string,
    action: HumanInterventionAction
  ): Promise<void> => {
    setActiveAction({ interventionId, action });
    setError(null);

    try {
      const intervention = interventions.find(item => item.id === interventionId);
      const answerResult =
        action === 'continued' && intervention
          ? await saveInterventionAnswers(intervention)
          : { savedCount: 0, approvedAnswers: [] };
      const resolutionInput = {
        message:
          answerResult.savedCount > 0
            ? `Saved ${answerResult.savedCount} answer(s) for future reuse.`
            : undefined,
        ...(answerResult.approvedAnswers.length > 0
          ? { approvedAnswers: answerResult.approvedAnswers }
          : {})
      };
      await resolveHumanIntervention(interventionId, action, resolutionInput);
      await loadPendingInterventions();
      await onResolved?.();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Failed to resolve automation handoff'
      );
    } finally {
      setActiveAction(currentAction =>
        currentAction?.interventionId === interventionId && currentAction.action === action
          ? null
          : currentAction
      );
    }
  };

  if (!hasPendingInterventions) {
    return null;
  }

  return (
    <div className="human-intervention-panel" role="presentation">
      <section
        className="human-intervention-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="human-intervention-title"
      >
        <div className="human-intervention-header">
          <div>
            <p className="application-progress-eyebrow">Automation Handoffs</p>
            <h3 id="human-intervention-title">Human Intervention</h3>
            <p>Review blocked automation runs and choose how the bot should continue.</p>
          </div>
          <div className="human-intervention-header-actions">
            <span className="attention">{pendingCountLabel}</span>
            <button
              className="human-intervention-refresh-button"
              disabled={isLoading || Boolean(activeAction)}
              onClick={() => void loadPendingInterventions(true)}
            >
              {isLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {error && <p className="application-detail-error human-intervention-error">{error}</p>}

        <div className="human-intervention-list">
          {interventions.map(intervention => {
            const screenshotUrl = getHumanInterventionScreenshotUrl(intervention);
            const isActionRunning = activeAction?.interventionId === intervention.id;
            const companyLabel = getCompanyLabel(intervention);
            const roleLabel = getRoleLabel(intervention);
            const humanReviewFields = readHumanReviewFields(intervention.metadata);
            const savedAnswerSuggestions = readSavedAnswerSuggestions(intervention.metadata);

            return (
              <article className="human-intervention-card" key={intervention.id}>
                <div className="human-intervention-card-main">
                  <div className="human-intervention-card-copy">
                    <div className="human-intervention-title-row">
                      <h4>{roleLabel}</h4>
                      <span>{REASON_LABELS[intervention.reason]}</span>
                    </div>
                    <p className="human-intervention-company">{companyLabel}</p>
                    <p className="human-intervention-message">{intervention.message}</p>
                    <div className="human-intervention-meta">
                      {intervention.applicationId && (
                        <span>Application: {intervention.applicationId}</span>
                      )}
                      {intervention.applicationRunId && (
                        <span>Run: {intervention.applicationRunId}</span>
                      )}
                      <time dateTime={intervention.createdAt}>
                        Waiting since {formatTimestamp(intervention.createdAt)}
                      </time>
                    </div>
                    <div className="human-intervention-links">
                      {intervention.pageUrl && (
                        <a href={intervention.pageUrl} target="_blank" rel="noreferrer">
                          {intervention.pageUrl}
                        </a>
                      )}
                      {(intervention.artifacts || [])
                        .filter(artifact => artifact.url)
                        .slice(-8)
                        .map(artifact => (
                          <a
                            key={`${artifact.kind}-${artifact.step}-${artifact.label}`}
                            href={getHumanInterventionArtifactUrl(artifact.url)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {getArtifactLabel(artifact.kind, artifact.label)}
                          </a>
                        ))}
                    </div>
                    {savedAnswerSuggestions.length > 0 && (
                      <div className="human-intervention-saved-suggestions">
                        <strong>Reused saved answer suggested</strong>
                        {savedAnswerSuggestions.map(suggestion => (
                          <p key={`${suggestion.controlIndex}-${suggestion.question}`}>
                            {suggestion.question}: {suggestion.answer}
                          </p>
                        ))}
                      </div>
                    )}
                    {humanReviewFields.length > 0 && (
                      <div className="human-intervention-answer-fields">
                        {humanReviewFields.map(field => {
                          const fieldKey = getFieldKey(intervention.id, field);
                          const draft = answerDrafts[fieldKey] || {
                            answer: '',
                            saveForFuture: false,
                            allowAutoReuse: field.safetyCategory === 'safe'
                          };
                          const suggestedAnswer = findSavedAnswerSuggestion(field, savedAnswers);
                          const isSensitive = SENSITIVE_SAVED_ANSWER_CATEGORIES.has(
                            field.safetyCategory
                          );

                          return (
                            <div key={fieldKey} className="human-intervention-answer-field">
                              <div className="human-intervention-answer-field-header">
                                <strong>{field.question}</strong>
                                <span className={isSensitive ? 'manual' : 'safe'}>
                                  {isSensitive
                                    ? `${formatCategory(field.safetyCategory)} needs approval`
                                    : 'Safe answer'}
                                </span>
                              </div>
                              {field.reason && <p>{field.reason}</p>}
                              {suggestedAnswer && (
                                <button
                                  type="button"
                                  className="human-intervention-use-suggestion"
                                  onClick={() =>
                                    updateAnswerDraft(fieldKey, {
                                      answer: suggestedAnswer.answer,
                                      savedFormAnswerId: suggestedAnswer.id
                                    })
                                  }
                                >
                                  Use saved answer: {suggestedAnswer.answer}
                                </button>
                              )}
                              <textarea
                                rows={3}
                                placeholder="Enter the approved answer"
                                value={draft.answer}
                                onChange={event =>
                                  updateAnswerDraft(fieldKey, { answer: event.target.value })
                                }
                              />
                              <div className="human-intervention-answer-options">
                                <label>
                                  <input
                                    type="checkbox"
                                    checked={draft.saveForFuture}
                                    onChange={event =>
                                      updateAnswerDraft(fieldKey, {
                                        saveForFuture: event.target.checked
                                      })
                                    }
                                  />
                                  <span>Save for future</span>
                                </label>
                                <label>
                                  <input
                                    type="checkbox"
                                    disabled={isSensitive}
                                    checked={!isSensitive && draft.allowAutoReuse}
                                    onChange={event =>
                                      updateAnswerDraft(fieldKey, {
                                        allowAutoReuse: event.target.checked
                                      })
                                    }
                                  />
                                  <span>
                                    {isSensitive
                                      ? 'Require approval each time'
                                      : 'Reuse automatically'}
                                  </span>
                                </label>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {screenshotUrl && !imageErrors[intervention.id] && (
                    <a
                      className="human-intervention-screenshot"
                      href={screenshotUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open screenshot for ${roleLabel}`}
                    >
                      <img
                        src={screenshotUrl}
                        alt={`Automation handoff screenshot for ${roleLabel}`}
                        onError={() =>
                          setImageErrors(currentErrors => ({
                            ...currentErrors,
                            [intervention.id]: true
                          }))
                        }
                      />
                    </a>
                  )}
                </div>

                <div className="human-intervention-actions">
                  {(['continued', 'skipped', 'failed'] as HumanInterventionAction[]).map(action => (
                    <button
                      key={action}
                      className={`human-intervention-action-button ${ACTION_CLASS_NAMES[action]}`}
                      disabled={Boolean(activeAction)}
                      onClick={() => void handleAction(intervention.id, action)}
                    >
                      {isActionRunning && activeAction?.action === action
                        ? 'Saving...'
                        : ACTION_LABELS[action]}
                    </button>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default HumanInterventionPanel;
