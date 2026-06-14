import React, { useEffect, useMemo, useState } from 'react';
import {
  HumanInterventionAction,
  HumanInterventionRecord,
  fetchPendingHumanInterventions,
  getHumanInterventionArtifactUrl,
  getHumanInterventionScreenshotUrl,
  resolveHumanIntervention
} from '../services/humanInterventionApi';

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

const HumanInterventionPanel: React.FC<HumanInterventionPanelProps> = ({ onResolved }) => {
  const [interventions, setInterventions] = useState<HumanInterventionRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<{
    interventionId: string;
    action: HumanInterventionAction;
  } | null>(null);
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});
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

  const handleAction = async (
    interventionId: string,
    action: HumanInterventionAction
  ): Promise<void> => {
    setActiveAction({ interventionId, action });
    setError(null);

    try {
      await resolveHumanIntervention(interventionId, action);
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
