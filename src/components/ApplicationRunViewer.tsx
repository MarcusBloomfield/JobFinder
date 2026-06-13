import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApplicationRunRecord,
  ApplicationRunStatus
} from '../models/ApplicationRun';
import {
  cancelApplicationRun,
  fetchApplicationRuns,
  getApplicationRunArtifactUrl,
  getApplicationRunScreenshotUrl,
  getApplicationRunSnapshotUrl
} from '../services/applicationRunService';

interface ApplicationRunViewerProps {
  applicationId: string;
  onRunsChanged?: () => Promise<void>;
}

const POLL_INTERVAL_MS = 4000;

const RUN_STATUS_LABELS: Record<ApplicationRunStatus, string> = {
  running: 'Running',
  waiting_for_user: 'Waiting For User',
  ready_for_review: 'Ready For Review',
  submitted: 'Submitted',
  skipped: 'Skipped',
  failed: 'Failed'
};

const TERMINAL_RUN_STATUSES: ApplicationRunStatus[] = ['submitted', 'skipped', 'failed'];

const formatTimestamp = (value: string): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));

const formatMetadataLabel = (value?: string): string =>
  value
    ? value
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, character => character.toUpperCase())
    : 'Unknown';

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
  }

  return undefined;
};

const getRunAdapterLabel = (run: ApplicationRunRecord): string => {
  const metadata = run.diagnostics?.metadata || run.metadata;
  const adapter = readMetadataText(metadata, ['adapter', 'adapterName', 'platformAdapter']);

  if (adapter) {
    return formatMetadataLabel(adapter);
  }

  if (run.platform && run.platform !== 'unknown') {
    return `${formatMetadataLabel(run.platform)} Adapter`;
  }

  return 'Unknown';
};

const getRunFailureReason = (run: ApplicationRunRecord): string | undefined =>
  run.diagnostics?.errorMessage || run.errorMessage;

const getRunStatusClass = (status: ApplicationRunStatus): string =>
  status.replace(/_/g, '-');

const getArtifactLabel = (kind: string): string => formatMetadataLabel(kind);

const isRunActive = (run: ApplicationRunRecord): boolean =>
  !run.completedAt && !TERMINAL_RUN_STATUSES.includes(run.status);

const ApplicationRunViewer: React.FC<ApplicationRunViewerProps> = ({
  applicationId,
  onRunsChanged
}) => {
  const [runs, setRuns] = useState<ApplicationRunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCancelRunId, setActiveCancelRunId] = useState<string | null>(null);
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

  const selectedRun = useMemo(
    () => runs.find(run => run.id === selectedRunId) || runs[0] || null,
    [runs, selectedRunId]
  );
  const hasActiveRuns = runs.some(isRunActive);

  const loadRuns = useCallback(
    async (showLoading: boolean = false): Promise<void> => {
      if (showLoading) {
        setIsLoading(true);
      }

      try {
        const nextRuns = await fetchApplicationRuns({
          applicationId,
          limit: 20
        });
        setRuns(nextRuns);
        setSelectedRunId(currentRunId =>
          currentRunId && nextRuns.some(run => run.id === currentRunId)
            ? currentRunId
            : nextRuns[0]?.id || null
        );
        setError(null);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load application runs'
        );
      } finally {
        if (showLoading) {
          setIsLoading(false);
        }
      }
    },
    [applicationId]
  );

  useEffect(() => {
    setRuns([]);
    setSelectedRunId(null);
    setImageErrors({});
    void loadRuns(true);
  }, [loadRuns]);

  useEffect(() => {
    if (!hasActiveRuns) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void loadRuns();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [hasActiveRuns, loadRuns]);

  const handleCancelRun = async (runId: string): Promise<void> => {
    setActiveCancelRunId(runId);
    setError(null);

    try {
      await cancelApplicationRun(runId);
      await loadRuns();
      await onRunsChanged?.();
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : 'Failed to cancel application run'
      );
    } finally {
      setActiveCancelRunId(currentRunId => (currentRunId === runId ? null : currentRunId));
    }
  };

  return (
    <div className="application-run-viewer">
      <div className="application-progress-subheader">
        <h4>Application Runs</h4>
        <div className="application-run-viewer-actions">
          <span>
            {runs.length > 0
              ? `${runs.length} run${runs.length === 1 ? '' : 's'} loaded`
              : 'No run history'}
          </span>
          <button
            className="application-run-refresh-button"
            disabled={isLoading || Boolean(activeCancelRunId)}
            onClick={() => void loadRuns(true)}
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <p className="application-detail-error">{error}</p>}

      {runs.length === 0 ? (
        <div className="application-progress-empty">
          <p>No browser run records are linked to this application yet.</p>
        </div>
      ) : (
        <div className="application-run-viewer-layout">
          <div className="application-run-list" aria-label="Application run history">
            {runs.map(run => (
              <button
                key={run.id}
                className={`application-run-list-item ${
                  selectedRun?.id === run.id ? 'active' : ''
                }`}
                onClick={() => setSelectedRunId(run.id)}
              >
                <span className={`application-run-status ${getRunStatusClass(run.status)}`}>
                  {RUN_STATUS_LABELS[run.status]}
                </span>
                <strong>Step {run.currentStep}</strong>
                <time dateTime={run.updatedAt}>{formatTimestamp(run.updatedAt)}</time>
              </button>
            ))}
          </div>

          {selectedRun && (
            <article className="application-run-detail">
              <div className="application-run-detail-grid">
                <div className="application-detail-meta-item">
                  <span>Status</span>
                  <strong>{RUN_STATUS_LABELS[selectedRun.status]}</strong>
                </div>
                <div className="application-detail-meta-item">
                  <span>Current step</span>
                  <strong>{selectedRun.currentStep}</strong>
                </div>
                <div className="application-detail-meta-item">
                  <span>Platform</span>
                  <strong>{formatMetadataLabel(selectedRun.platform)}</strong>
                </div>
                <div className="application-detail-meta-item">
                  <span>Adapter</span>
                  <strong>{getRunAdapterLabel(selectedRun)}</strong>
                </div>
                <div className="application-detail-meta-item">
                  <span>Started</span>
                  <strong>{formatTimestamp(selectedRun.createdAt)}</strong>
                </div>
                <div className="application-detail-meta-item">
                  <span>Updated</span>
                  <strong>{formatTimestamp(selectedRun.updatedAt)}</strong>
                </div>
              </div>

              <div className="application-run-current-url">
                <span>Current URL</span>
                {selectedRun.currentUrl ? (
                  <a href={selectedRun.currentUrl} target="_blank" rel="noreferrer">
                    {selectedRun.currentUrl}
                  </a>
                ) : (
                  <strong>Unavailable</strong>
                )}
              </div>

              <div className="application-run-intervention-row">
                <div>
                  <span>Intervention</span>
                  <strong>
                    {selectedRun.intervention
                      ? formatMetadataLabel(selectedRun.intervention.status)
                      : 'None'}
                  </strong>
                </div>
                {selectedRun.intervention && (
                  <p>
                    {formatMetadataLabel(selectedRun.intervention.reason)}: {selectedRun.intervention.message}
                  </p>
                )}
              </div>

              {getRunFailureReason(selectedRun) && (
                <div className="application-run-failure">
                  <span>Failure Reason</span>
                  <p>{getRunFailureReason(selectedRun)}</p>
                </div>
              )}

              {getApplicationRunScreenshotUrl(selectedRun) && !imageErrors[selectedRun.id] && (
                <a
                  className="application-run-screenshot"
                  href={getApplicationRunScreenshotUrl(selectedRun)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={getApplicationRunScreenshotUrl(selectedRun)}
                    alt={`Last screenshot for application run ${selectedRun.id}`}
                    onError={() =>
                      setImageErrors(currentErrors => ({
                        ...currentErrors,
                        [selectedRun.id]: true
                      }))
                    }
                  />
                </a>
              )}

              <div className="application-run-links">
                {getApplicationRunSnapshotUrl(selectedRun) && (
                  <a
                    href={getApplicationRunSnapshotUrl(selectedRun)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Page Snapshot
                  </a>
                )}
                {(selectedRun.artifacts || selectedRun.diagnostics?.artifacts || [])
                  .filter(artifact => artifact.url)
                  .slice(-8)
                  .map(artifact => (
                    <a
                      key={`${artifact.kind}-${artifact.step}-${artifact.label}`}
                      href={getApplicationRunArtifactUrl(artifact.url)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {getArtifactLabel(artifact.kind)}
                    </a>
                  ))}
                {isRunActive(selectedRun) && (
                  <button
                    className="application-run-cancel-button"
                    disabled={Boolean(activeCancelRunId)}
                    onClick={() => void handleCancelRun(selectedRun.id)}
                  >
                    {activeCancelRunId === selectedRun.id ? 'Cancelling...' : 'Cancel Run'}
                  </button>
                )}
              </div>
            </article>
          )}
        </div>
      )}
    </div>
  );
};

export default ApplicationRunViewer;
