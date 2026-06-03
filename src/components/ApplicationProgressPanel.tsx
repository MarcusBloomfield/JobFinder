import React, { useMemo, useState } from 'react';
import { Job } from '../models/Job';
import {
  ApplicationTrackingSummary,
  TrackedApplicationStatus,
  TrackedJobApplication
} from '../models/ApplicationTracking';

interface ApplicationProgressPanelProps {
  summary: ApplicationTrackingSummary | null;
  history: TrackedJobApplication[];
  jobs: Job[];
  isLoading: boolean;
  onRefresh: () => Promise<void>;
}

const STATUS_LABELS: Record<TrackedApplicationStatus, string> = {
  applying: 'Applying',
  applied: 'Applied',
  review_required: 'Needs Review',
  failed: 'Failed',
  skipped: 'Skipped'
};

const formatDateLabel = (value: string): string => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
};

const formatTimestamp = (value: string): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));

const getApplicationTimestampLabel = (application: TrackedJobApplication): string => {
  if (application.status === 'applied') {
    return 'Applied At';
  }

  if (application.completedAt) {
    return 'Run Completed';
  }

  return 'Run Started';
};

const getApplicationTimestampValue = (application: TrackedJobApplication): string =>
  application.completedAt || application.createdAt;

const getSearchSnapshot = (jobs: Job[]) => ({
  discovered: jobs.length,
  strongMatches: jobs.filter(job => (job.matchScore || 0) >= 80).length,
  readyToApply: jobs.filter(
    job =>
      (job.matchScore || 0) >= 60 &&
      job.applicationStatus !== 'applied' &&
      job.applicationStatus !== 'applying' &&
      job.applicationStatus !== 'skipped'
  ).length,
  actioned: jobs.filter(
    job =>
      job.applicationStatus === 'applied' ||
      job.applicationStatus === 'review_required' ||
      job.applicationStatus === 'failed' ||
      job.applicationStatus === 'skipped' ||
      Boolean(job.applicationTrackingId)
  ).length
});

const ApplicationProgressPanel: React.FC<ApplicationProgressPanelProps> = ({
  summary,
  history,
  jobs,
  isLoading,
  onRefresh
}) => {
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const maxDailyCount = Math.max(1, ...(summary?.recentActivity.map(point => point.totalCount) || [0]));
  const searchSnapshot = getSearchSnapshot(jobs);
  const activePipelineCount = (summary?.statusCounts.applying || 0) + (summary?.statusCounts.review_required || 0);
  const selectedApplication = useMemo(
    () => history.find(application => application.id === selectedApplicationId) || null,
    [history, selectedApplicationId]
  );

  return (
    <>
      <section className="application-progress-page">
        <div className="application-progress-page-header">
          <div>
            <p className="application-progress-eyebrow">Progress</p>
            <h2>Job Search Progress</h2>
            <p className="application-progress-description">
              This page pulls from the SQLite-backed tracking data and shows how your search and
              auto-apply pipeline are moving over time.
            </p>
          </div>
          <button
            className="application-progress-refresh-button"
            disabled={isLoading}
            onClick={() => void onRefresh()}
          >
            {isLoading ? 'Refreshing...' : 'Refresh Stats'}
          </button>
        </div>

        <div className="application-progress-layout">
          <section className="application-progress-section-card">
            <div className="application-progress-subheader">
              <h3>Current Search Snapshot</h3>
              <span>{jobs.length > 0 ? 'Based on the jobs currently loaded in the search view' : 'Run a search to populate these stats'}</span>
            </div>
            <div className="application-progress-stats">
              <article className="application-progress-stat-card">
                <span className="application-progress-stat-label">Jobs Loaded</span>
                <strong>{searchSnapshot.discovered}</strong>
              </article>
              <article className="application-progress-stat-card">
                <span className="application-progress-stat-label">80%+ Matches</span>
                <strong>{searchSnapshot.strongMatches}</strong>
              </article>
              <article className="application-progress-stat-card">
                <span className="application-progress-stat-label">Ready To Apply</span>
                <strong>{searchSnapshot.readyToApply}</strong>
              </article>
              <article className="application-progress-stat-card">
                <span className="application-progress-stat-label">Actioned Jobs</span>
                <strong>{searchSnapshot.actioned}</strong>
              </article>
            </div>
          </section>

          <section className="application-progress-section-card">
            <div className="application-progress-subheader">
              <h3>Persistent Tracking Stats</h3>
              <span>{summary ? `${summary.totalApplications} runs stored in SQLite` : 'Waiting for tracking data'}</span>
            </div>
            {!summary ? (
              <div className="application-progress-empty">
                <p>No tracking data is available yet.</p>
              </div>
            ) : (
              <div className="application-progress-stats">
                <article className="application-progress-stat-card">
                  <span className="application-progress-stat-label">Tracked Runs</span>
                  <strong>{summary.totalApplications}</strong>
                </article>
                <article className="application-progress-stat-card">
                  <span className="application-progress-stat-label">Applied</span>
                  <strong>{summary.statusCounts.applied}</strong>
                </article>
                <article className="application-progress-stat-card">
                  <span className="application-progress-stat-label">Active Pipeline</span>
                  <strong>{activePipelineCount}</strong>
                </article>
                <article className="application-progress-stat-card">
                  <span className="application-progress-stat-label">Success Rate</span>
                  <strong>{summary.successRate}%</strong>
                </article>
              </div>
            )}
          </section>

          <section className="application-progress-section-card application-progress-wide-card">
            <div className="application-progress-grid">
              <div className="application-activity-card">
                <div className="application-progress-subheader">
                  <h3>Activity Over 14 Days</h3>
                  <span>{summary ? `${summary.completedApplications} completed runs` : 'No activity yet'}</span>
                </div>
                {!summary || summary.recentActivity.length === 0 ? (
                  <div className="application-progress-empty">
                    <p>No recent tracked activity.</p>
                  </div>
                ) : (
                  <div className="application-activity-chart" aria-label="Application activity chart">
                    {summary.recentActivity.map(point => (
                      <div key={point.day} className="application-activity-bar-group">
                        <div
                          className="application-activity-bar"
                          style={{ height: `${Math.max(10, (point.totalCount / maxDailyCount) * 100)}%` }}
                          title={`${point.totalCount} tracked on ${point.day}`}
                        />
                        <span>{formatDateLabel(point.day)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="application-recent-card">
                <div className="application-progress-subheader">
                  <h3>Status Breakdown</h3>
                  <span>Stored outcomes across all tracked runs</span>
                </div>
                {!summary ? (
                  <div className="application-progress-empty">
                    <p>No status breakdown is available yet.</p>
                  </div>
                ) : (
                  <div className="application-status-breakdown">
                    {(
                      Object.entries(summary.statusCounts) as Array<[TrackedApplicationStatus, number]>
                    ).map(([status, count]) => (
                      <article key={status} className="application-status-breakdown-item">
                        <span className={`application-status ${status.replace('_', '-')}`}>
                          {STATUS_LABELS[status]}
                        </span>
                        <strong>{count}</strong>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="application-progress-section-card application-progress-wide-card">
            <div className="application-progress-subheader">
              <h3>Recent Application Runs</h3>
              <span>{history.length > 0 ? `${history.length} most recent runs loaded` : 'No tracked application history yet'}</span>
            </div>
            {history.length === 0 ? (
              <div className="application-progress-empty">
                <p>Start applying to jobs and your recent run history will appear here.</p>
              </div>
            ) : (
              <div className="application-history-list">
                {history.map(application => (
                  <article key={application.id} className="application-history-item">
                    <div className="application-history-main">
                      <div className="application-history-copy">
                        <div className="application-history-title-row">
                          <strong>{application.title}</strong>
                          <span className={`application-status ${application.status.replace('_', '-')}`}>
                            {STATUS_LABELS[application.status]}
                          </span>
                        </div>
                        <span className="application-history-company">{application.company}</span>
                        <p className="application-history-message">{application.message}</p>
                      </div>
                      <div className="application-history-meta">
                        <span>Resume: {application.resumeFileName}</span>
                        <span>Match at apply: {typeof application.matchScore === 'number' ? `${application.matchScore}%` : 'Unavailable'}</span>
                        <span>Source: {application.triggerSource === 'bulk' ? 'Bulk auto-apply' : 'Manual apply'}</span>
                        <time dateTime={getApplicationTimestampValue(application)}>
                          {formatTimestamp(getApplicationTimestampValue(application))}
                        </time>
                      </div>
                    </div>
                    <div className="application-history-actions">
                      <button
                        className="application-history-open-button"
                        onClick={() => setSelectedApplicationId(application.id)}
                      >
                        View Details
                      </button>
                      <a href={application.jobUrl} target="_blank" rel="noreferrer">
                        Job Listing
                      </a>
                      {application.finalUrl && application.finalUrl !== application.jobUrl && (
                        <a href={application.finalUrl} target="_blank" rel="noreferrer">
                          Final Page
                        </a>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>

      {selectedApplication && (
        <div
          className="application-detail-overlay"
          onClick={() => setSelectedApplicationId(null)}
          role="presentation"
        >
          <section
            className="application-detail-modal"
            onClick={event => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="application-detail-title"
          >
            <div className="application-detail-header">
              <div>
                <p className="application-progress-eyebrow">Application Detail</p>
                <h3 id="application-detail-title">{selectedApplication.title}</h3>
                <p className="application-detail-company">{selectedApplication.company}</p>
              </div>
              <button
                className="application-detail-close-button"
                onClick={() => setSelectedApplicationId(null)}
              >
                Close
              </button>
            </div>

            <div className="application-detail-grid">
              <article className="application-detail-card">
                <span className="application-progress-stat-label">{getApplicationTimestampLabel(selectedApplication)}</span>
                <strong>{formatTimestamp(getApplicationTimestampValue(selectedApplication))}</strong>
              </article>
              <article className="application-detail-card">
                <span className="application-progress-stat-label">Resume Used</span>
                <strong>{selectedApplication.resumeFileName}</strong>
              </article>
              <article className="application-detail-card">
                <span className="application-progress-stat-label">Match At Application</span>
                <strong>
                  {typeof selectedApplication.matchScore === 'number'
                    ? `${selectedApplication.matchScore}%`
                    : 'Unavailable'}
                </strong>
              </article>
              <article className="application-detail-card">
                <span className="application-progress-stat-label">Status</span>
                <strong>{STATUS_LABELS[selectedApplication.status]}</strong>
              </article>
            </div>

            <div className="application-detail-meta-grid">
              <div className="application-detail-meta-item">
                <span>Run started</span>
                <strong>{formatTimestamp(selectedApplication.createdAt)}</strong>
              </div>
              <div className="application-detail-meta-item">
                <span>Last updated</span>
                <strong>{formatTimestamp(selectedApplication.updatedAt)}</strong>
              </div>
              <div className="application-detail-meta-item">
                <span>Completion time</span>
                <strong>
                  {selectedApplication.completedAt
                    ? formatTimestamp(selectedApplication.completedAt)
                    : 'Still in progress'}
                </strong>
              </div>
              <div className="application-detail-meta-item">
                <span>Apply mode</span>
                <strong>{selectedApplication.triggerSource === 'bulk' ? 'Bulk auto-apply' : 'Manual apply'}</strong>
              </div>
            </div>

            <div className="application-detail-cover-letter">
              <div className="application-progress-subheader">
                <h4>Cover Letter</h4>
                <span>
                  {selectedApplication.coverLetterUsed
                    ? 'Captured from the text used during the application'
                    : 'Stored draft generated for this application run'}
                </span>
              </div>
              <div className="application-detail-cover-letter-body">
                {selectedApplication.coverLetterText ? (
                  <p>{selectedApplication.coverLetterText}</p>
                ) : (
                  <p>No cover letter snapshot is available for this application.</p>
                )}
              </div>
            </div>

            <div className="application-detail-job-description">
              <div className="application-progress-subheader">
                <h4>Full Job Description</h4>
                <span>Stored with the application snapshot</span>
              </div>
              <div className="application-detail-job-description-body">
                {selectedApplication.description ? (
                  <p>{selectedApplication.description}</p>
                ) : (
                  <p>No job description snapshot is available for this application.</p>
                )}
              </div>
            </div>

            <div className="application-history-actions">
              <a href={selectedApplication.jobUrl} target="_blank" rel="noreferrer">
                Open Job Listing
              </a>
              {selectedApplication.finalUrl && (
                <a href={selectedApplication.finalUrl} target="_blank" rel="noreferrer">
                  Open Final Page
                </a>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
};

export default ApplicationProgressPanel;
