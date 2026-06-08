import React, { useEffect, useMemo, useState } from 'react';
import { Job } from '../models/Job';
import {
  DEFAULT_JOB_DETAILS,
  JOB_APPLICATION_METHOD_LABELS,
  JobApplicationMethod,
  JobDetails
} from '../models/JobDetails';
import {
  ApplicationProgressStage,
  ApplicationTrackingSummary,
  TrackedApplicationStatus,
  TrackedJobApplication
} from '../models/ApplicationTracking';
import HumanInterventionPanel from './HumanInterventionPanel';

interface ApplicationProgressPanelProps {
  summary: ApplicationTrackingSummary | null;
  history: TrackedJobApplication[];
  jobs: Job[];
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onUpdateJobDetails: (applicationId: string, jobDetails: JobDetails) => Promise<void>;
  onUpdateProgressStage: (
    applicationId: string,
    stage: ApplicationProgressStage
  ) => Promise<void>;
  onEnrichApplication: (applicationId: string) => Promise<void>;
}

const STATUS_LABELS: Record<TrackedApplicationStatus, string> = {
  applying: 'Applying',
  applied: 'Applied',
  review_required: 'Needs Review',
  failed: 'Failed',
  skipped: 'Skipped'
};

const APPLICATION_METHOD_OPTIONS = Object.entries(JOB_APPLICATION_METHOD_LABELS) as Array<
  [Exclude<JobApplicationMethod, ''>, string]
>;

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

const getAppliedResumeLabel = (application: TrackedJobApplication): string =>
  `${application.resumeFileName} (Uploaded)`;

const shouldEnrichApplication = (application: TrackedJobApplication): boolean =>
  !application.company.trim() ||
  !application.description.trim() ||
  !application.location?.trim() ||
  !application.jobDetails.employerName.trim() ||
  !application.jobDetails.jobLocation.trim() ||
  !application.jobDetails.suburbOrPostcode.trim();

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

const getBooleanSelectValue = (value: boolean): 'yes' | 'no' => (value ? 'yes' : 'no');

const canMarkApplicationAsApplied = (application: TrackedJobApplication): boolean =>
  application.status !== 'applied' || !application.jobDetails.applicationSubmittedDate;

const canMarkApplicationAsInterviewed = (application: TrackedJobApplication): boolean =>
  !application.jobDetails.interviewedForJob;

type ActivityStage = 'applied' | 'interviewed' | 'employed';
type CalendarStage = ActivityStage | 'none';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const getCalendarStage = (
  point?: ApplicationTrackingSummary['activityCalendar'][number]
): CalendarStage => {
  if (!point) {
    return 'none';
  }

  if (point.employedCount > 0) {
    return 'employed';
  }

  if (point.interviewedCount > 0) {
    return 'interviewed';
  }

  if (point.appliedCount > 0) {
    return 'applied';
  }

  return 'none';
};

const getStartOfWeek = (date: Date): Date => {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() - nextDate.getUTCDay());
  return nextDate;
};

const getEndOfWeek = (date: Date): Date => {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + (6 - nextDate.getUTCDay()));
  return nextDate;
};

const toDateKey = (date: Date): string => date.toISOString().slice(0, 10);

const buildCalendarWeeks = (year: number): Date[][] => {
  const firstDay = new Date(Date.UTC(year, 0, 1));
  const lastDay = new Date(Date.UTC(year, 11, 31));
  const start = getStartOfWeek(firstDay);
  const end = getEndOfWeek(lastDay);
  const weeks: Date[][] = [];
  let cursor = new Date(start);

  while (cursor <= end) {
    const week: Date[] = [];

    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      week.push(new Date(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    weeks.push(week);
  }

  return weeks;
};

const ApplicationProgressPanel: React.FC<ApplicationProgressPanelProps> = ({
  summary,
  history,
  jobs,
  isLoading,
  onRefresh,
  onUpdateJobDetails,
  onUpdateProgressStage,
  onEnrichApplication
}) => {
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const [selectedActivityYear, setSelectedActivityYear] = useState<number | null>(null);
  const [jobDetailsDraft, setJobDetailsDraft] = useState<JobDetails>({ ...DEFAULT_JOB_DETAILS });
  const [jobDetailsError, setJobDetailsError] = useState<string | null>(null);
  const [isSavingJobDetails, setIsSavingJobDetails] = useState<boolean>(false);
  const [pendingProgressUpdate, setPendingProgressUpdate] = useState<{
    applicationId: string;
    stage: ApplicationProgressStage;
  } | null>(null);
  const [progressUpdateError, setProgressUpdateError] = useState<string | null>(null);
  const [isEnrichingApplication, setIsEnrichingApplication] = useState<boolean>(false);
  const [applicationEnrichmentError, setApplicationEnrichmentError] = useState<string | null>(null);
  const [enrichmentRequestedForApplicationId, setEnrichmentRequestedForApplicationId] =
    useState<string | null>(null);
  const searchSnapshot = getSearchSnapshot(jobs);
  const selectedApplication = useMemo(
    () => history.find(application => application.id === selectedApplicationId) || null,
    [history, selectedApplicationId]
  );
  const activityYears = summary?.activityYears || [];
  const activeActivityYear = selectedActivityYear ?? activityYears[0] ?? new Date().getUTCFullYear();
  const activityPointsByDay = useMemo(
    () =>
      new Map(
        (summary?.activityCalendar || [])
          .filter(point => Number(point.day.slice(0, 4)) === activeActivityYear)
          .map(point => [point.day, point] as const)
      ),
    [summary, activeActivityYear]
  );
  const activityWeeks = useMemo(() => buildCalendarWeeks(activeActivityYear), [activeActivityYear]);
  const activityMonthLabels = useMemo(
    () =>
      activityWeeks.map(week => {
        const firstInYear = week.find(day => day.getUTCFullYear() === activeActivityYear);
        if (!firstInYear) {
          return '';
        }

        return firstInYear.getUTCDate() <= 7 ? MONTH_LABELS[firstInYear.getUTCMonth()] : '';
      }),
    [activityWeeks, activeActivityYear]
  );

  useEffect(() => {
    if (activityYears.length === 0) {
      setSelectedActivityYear(null);
      return;
    }

    setSelectedActivityYear(currentYear =>
      currentYear && activityYears.includes(currentYear) ? currentYear : activityYears[0]
    );
  }, [activityYears]);

  useEffect(() => {
    if (!selectedApplication) {
      setJobDetailsDraft({ ...DEFAULT_JOB_DETAILS });
      setJobDetailsError(null);
      setProgressUpdateError(null);
      setApplicationEnrichmentError(null);
      setEnrichmentRequestedForApplicationId(null);
      return;
    }

    setJobDetailsDraft(selectedApplication.jobDetails);
    setJobDetailsError(null);
  }, [selectedApplication]);

  useEffect(() => {
    setProgressUpdateError(null);
  }, [history]);

  useEffect(() => {
    if (!selectedApplication) {
      setIsEnrichingApplication(false);
      return;
    }

    if (
      !shouldEnrichApplication(selectedApplication) ||
      enrichmentRequestedForApplicationId === selectedApplication.id
    ) {
      return;
    }

    setEnrichmentRequestedForApplicationId(selectedApplication.id);
    setApplicationEnrichmentError(null);
    setIsEnrichingApplication(true);

    void onEnrichApplication(selectedApplication.id)
      .catch(error => {
        setApplicationEnrichmentError(
          error instanceof Error ? error.message : 'Failed to refresh job details from the listing'
        );
      })
      .finally(() => {
        setIsEnrichingApplication(false);
      });
  }, [selectedApplication, enrichmentRequestedForApplicationId, onEnrichApplication]);

  const updateJobDetailsField = <Field extends keyof JobDetails>(
    field: Field,
    value: JobDetails[Field]
  ): void => {
    setJobDetailsDraft(currentDetails => ({
      ...currentDetails,
      [field]: value
    }));
  };

  const handleJobDetailsSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();

    if (!selectedApplication) {
      return;
    }

    setJobDetailsError(null);
    setIsSavingJobDetails(true);

    try {
      await onUpdateJobDetails(selectedApplication.id, jobDetailsDraft);
    } catch (error) {
      setJobDetailsError(
        error instanceof Error ? error.message : 'Failed to save job details'
      );
    } finally {
      setIsSavingJobDetails(false);
    }
  };

  const handleProgressUpdate = async (
    applicationId: string,
    stage: ApplicationProgressStage
  ): Promise<void> => {
    setProgressUpdateError(null);
    setPendingProgressUpdate({ applicationId, stage });

    try {
      await onUpdateProgressStage(applicationId, stage);
    } catch (error) {
      setProgressUpdateError(
        error instanceof Error ? error.message : 'Failed to update application progress'
      );
    } finally {
      setPendingProgressUpdate(currentUpdate =>
        currentUpdate &&
        currentUpdate.applicationId === applicationId &&
        currentUpdate.stage === stage
          ? null
          : currentUpdate
      );
    }
  };

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

        <HumanInterventionPanel onResolved={onRefresh} />

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
                  <span className="application-progress-stat-label">Jobs Applied For</span>
                  <strong>{summary.appliedCount}</strong>
                </article>
                <article className="application-progress-stat-card">
                  <span className="application-progress-stat-label">Interviewed For</span>
                  <strong>{summary.interviewedCount}</strong>
                </article>
                <article className="application-progress-stat-card">
                  <span className="application-progress-stat-label">Employed For</span>
                  <strong>{summary.employedCount}</strong>
                </article>
                <article className="application-progress-stat-card">
                  <span className="application-progress-stat-label">Tracked Runs</span>
                  <strong>{summary.totalApplications}</strong>
                </article>
              </div>
            )}
          </section>

          <section className="application-progress-section-card application-progress-wide-card">
            <div className="application-activity-card">
              <div className="application-progress-subheader">
                <h3>Yearly Activity</h3>
                {activityYears.length > 0 ? (
                  <select
                    className="application-activity-year-select"
                    value={activeActivityYear}
                    onChange={event => setSelectedActivityYear(Number(event.target.value))}
                  >
                    {activityYears.map(year => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span>No activity yet</span>
                )}
              </div>
              {!summary || activityYears.length === 0 ? (
                <div className="application-progress-empty">
                  <p>No tracked activity is available yet.</p>
                </div>
              ) : (
                <div className="application-activity-tracker" aria-label="Application activity tracker">
                  <div className="application-activity-calendar-scroll">
                    <div className="application-activity-month-labels" aria-hidden="true">
                      <span />
                      {activityMonthLabels.map((label, index) => (
                        <span key={`${activeActivityYear}-month-${index}`}>{label}</span>
                      ))}
                    </div>
                    <div className="application-activity-calendar-body">
                      <div className="application-activity-weekday-labels" aria-hidden="true">
                        {WEEKDAY_LABELS.map(label => (
                          <span key={label}>{label}</span>
                        ))}
                      </div>
                      <div className="application-activity-calendar-grid">
                        {activityWeeks.map((week, weekIndex) => (
                          <div
                            key={`${activeActivityYear}-week-${weekIndex}`}
                            className="application-activity-week-column"
                          >
                            {week.map(day => {
                              const dayKey = toDateKey(day);
                              const point = activityPointsByDay.get(dayKey);
                              const stage = getCalendarStage(point);
                              const isOutsideYear = day.getUTCFullYear() !== activeActivityYear;
                              const tooltipParts = [
                                formatDateLabel(dayKey),
                                `Employed: ${point?.employedCount || 0}`,
                                `Interviewed: ${point?.interviewedCount || 0}`,
                                `Applied: ${point?.appliedCount || 0}`
                              ];

                              return (
                                <div
                                  key={dayKey}
                                  className={`application-activity-cell ${stage}${isOutsideYear ? ' outside-year' : ''}`}
                                  title={tooltipParts.join(' | ')}
                                  aria-label={tooltipParts.join(', ')}
                                />
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="application-activity-legend" aria-hidden="true">
                      <span>Priority</span>
                      {(['employed', 'interviewed', 'applied'] as ActivityStage[]).map(stage => (
                        <React.Fragment key={stage}>
                          <span className={`application-activity-legend-swatch ${stage}`} />
                          <span>{stage.charAt(0).toUpperCase() + stage.slice(1)}</span>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                </div>
              )}
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
              <>
                {progressUpdateError && (
                  <p className="application-detail-error application-history-error">
                    {progressUpdateError}
                  </p>
                )}
                <div className="application-history-list">
                  {history.map(application => {
                    const isMarkingApplied =
                      pendingProgressUpdate?.applicationId === application.id &&
                      pendingProgressUpdate.stage === 'applied';
                    const isMarkingInterviewed =
                      pendingProgressUpdate?.applicationId === application.id &&
                      pendingProgressUpdate.stage === 'interviewed';

                    return (
                      <article key={application.id} className="application-history-item">
                        <div className="application-history-main">
                          <div className="application-history-copy">
                            <div className="application-history-title-row">
                              <strong>{application.title}</strong>
                              <span
                                className={`application-status ${application.status.replace('_', '-')}`}
                              >
                                {STATUS_LABELS[application.status]}
                              </span>
                              {application.jobDetails.interviewedForJob && (
                                <span className="application-history-stage-pill interviewed">
                                  Interviewed
                                </span>
                              )}
                              {application.jobDetails.employedForJob && (
                                <span className="application-history-stage-pill employed">
                                  Employed
                                </span>
                              )}
                            </div>
                            <span className="application-history-company">{application.company}</span>
                            <p className="application-history-message">{application.message}</p>
                          </div>
                          <div className="application-history-meta">
                            <span>Resume: {getAppliedResumeLabel(application)}</span>
                            <span>
                              Match at apply:{' '}
                              {typeof application.matchScore === 'number'
                                ? `${application.matchScore}%`
                                : 'Unavailable'}
                            </span>
                            <span>
                              Source:{' '}
                              {application.triggerSource === 'bulk'
                                ? 'Bulk auto-apply'
                                : 'Manual apply'}
                            </span>
                            <time dateTime={getApplicationTimestampValue(application)}>
                              {formatTimestamp(getApplicationTimestampValue(application))}
                            </time>
                          </div>
                        </div>
                        <div className="application-history-actions">
                          {canMarkApplicationAsApplied(application) && (
                            <button
                              className="application-history-stage-button"
                              disabled={Boolean(pendingProgressUpdate)}
                              onClick={() => void handleProgressUpdate(application.id, 'applied')}
                            >
                              {isMarkingApplied ? 'Saving Applied...' : 'Mark Applied'}
                            </button>
                          )}
                          {canMarkApplicationAsInterviewed(application) && (
                            <button
                              className="application-history-stage-button interviewed"
                              disabled={Boolean(pendingProgressUpdate)}
                              onClick={() =>
                                void handleProgressUpdate(application.id, 'interviewed')
                              }
                            >
                              {isMarkingInterviewed
                                ? 'Saving Interviewed...'
                                : 'Mark Interviewed'}
                            </button>
                          )}
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
                    );
                  })}
                </div>
              </>
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
                <strong>{getAppliedResumeLabel(selectedApplication)}</strong>
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

            <div className="application-detail-job-details">
              <div className="application-progress-subheader">
                <h4>Job Details</h4>
                <span>Store the employer and submission details for this application.</span>
              </div>

              <form className="application-detail-job-details-form" onSubmit={event => void handleJobDetailsSubmit(event)}>
                <div className="application-detail-form-grid">
                  <label className="application-profile-field">
                    <span>Employer name</span>
                    <input
                      type="text"
                      required
                      disabled={isSavingJobDetails || isEnrichingApplication}
                      value={jobDetailsDraft.employerName}
                      onChange={event => updateJobDetailsField('employerName', event.target.value)}
                    />
                  </label>

                  <label className="application-profile-field">
                    <span>Employer contact name (optional)</span>
                    <input
                      type="text"
                      disabled={isSavingJobDetails || isEnrichingApplication}
                      value={jobDetailsDraft.employerContactName}
                      onChange={event => updateJobDetailsField('employerContactName', event.target.value)}
                    />
                  </label>

                  <label className="application-profile-field">
                    <span>Employer contact email (optional)</span>
                    <input
                      type="email"
                      disabled={isSavingJobDetails || isEnrichingApplication}
                      value={jobDetailsDraft.employerContactEmail}
                      onChange={event => updateJobDetailsField('employerContactEmail', event.target.value)}
                    />
                  </label>

                  <label className="application-profile-field">
                    <span>Employer contact number (optional)</span>
                    <input
                      type="tel"
                      disabled={isSavingJobDetails || isEnrichingApplication}
                      value={jobDetailsDraft.employerContactNumber}
                      onChange={event => updateJobDetailsField('employerContactNumber', event.target.value)}
                    />
                  </label>

                  <label className="application-profile-field application-profile-field-wide">
                    <span>Job title</span>
                    <input
                      type="text"
                      required
                      disabled={isSavingJobDetails || isEnrichingApplication}
                      value={jobDetailsDraft.jobTitle}
                      onChange={event => updateJobDetailsField('jobTitle', event.target.value)}
                    />
                    <small className="application-detail-field-note">
                      This should be the same as what was listed in the application.
                    </small>
                  </label>

                  <label className="application-profile-field">
                    <span>Location of job (optional)</span>
                    <input
                      type="text"
                      disabled={isSavingJobDetails || isEnrichingApplication}
                      value={jobDetailsDraft.jobLocation}
                      onChange={event => updateJobDetailsField('jobLocation', event.target.value)}
                    />
                  </label>

                  <label className="application-profile-field">
                    <span>Suburb or postcode</span>
                    <input
                      type="text"
                      required
                      disabled={isSavingJobDetails || isEnrichingApplication}
                      value={jobDetailsDraft.suburbOrPostcode}
                      onChange={event => updateJobDetailsField('suburbOrPostcode', event.target.value)}
                    />
                  </label>

                  <label className="application-profile-field">
                    <span>How did you apply?</span>
                    <select
                      required
                      disabled={isSavingJobDetails || isEnrichingApplication}
                      value={jobDetailsDraft.applicationMethod}
                      onChange={event =>
                        updateJobDetailsField(
                          'applicationMethod',
                          event.target.value as JobApplicationMethod
                        )
                      }
                    >
                      <option value="">Please select</option>
                      {APPLICATION_METHOD_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="application-profile-field">
                    <span>Application submitted date</span>
                    <input
                      type="date"
                      required
                      disabled={isSavingJobDetails || isEnrichingApplication}
                      value={jobDetailsDraft.applicationSubmittedDate}
                      onChange={event =>
                        updateJobDetailsField('applicationSubmittedDate', event.target.value)
                      }
                    />
                  </label>

                  <label className="application-profile-field">
                    <span>Interviewed for this job?</span>
                    <select
                      disabled={isSavingJobDetails || isEnrichingApplication}
                      value={getBooleanSelectValue(jobDetailsDraft.interviewedForJob)}
                      onChange={event =>
                        updateJobDetailsField('interviewedForJob', event.target.value === 'yes')
                      }
                    >
                      <option value="no">No</option>
                      <option value="yes">Yes</option>
                    </select>
                  </label>

                  <label className="application-profile-field">
                    <span>Employed for this job?</span>
                    <select
                      disabled={isSavingJobDetails || isEnrichingApplication}
                      value={getBooleanSelectValue(jobDetailsDraft.employedForJob)}
                      onChange={event =>
                        updateJobDetailsField('employedForJob', event.target.value === 'yes')
                      }
                    >
                      <option value="no">No</option>
                      <option value="yes">Yes</option>
                    </select>
                  </label>
                </div>

                {jobDetailsError && <p className="application-detail-error">{jobDetailsError}</p>}
                {applicationEnrichmentError && (
                  <p className="application-detail-error">{applicationEnrichmentError}</p>
                )}

                <div className="application-detail-job-details-actions">
                  <span className="application-detail-job-details-help">
                    {isEnrichingApplication
                      ? 'Refreshing missing details from the job listing...'
                      : 'Employer contact details and the broader job location remain optional.'}
                  </span>
                  <button type="submit" disabled={isSavingJobDetails || isEnrichingApplication}>
                    {isSavingJobDetails
                      ? 'Saving...'
                      : isEnrichingApplication
                        ? 'Refreshing...'
                        : 'Save Job Details'}
                  </button>
                </div>
              </form>
            </div>

            <div className="application-detail-cover-letter">
              <div className="application-progress-subheader">
                <h4>Full Resume Used</h4>
                <span>
                  Most relevant uploaded resume used for this application
                </span>
              </div>
              <div className="application-detail-cover-letter-body">
                {selectedApplication.resumeContent ? (
                  <p>{selectedApplication.resumeContent}</p>
                ) : (
                  <p>No stored resume snapshot is available for this application.</p>
                )}
              </div>
            </div>

            <div className="application-detail-cover-letter">
              <div className="application-progress-subheader">
                <h4>Cover Letter</h4>
                <span>
                  {selectedApplication.coverLetterUsed
                    ? 'Generated document uploaded during the application'
                    : 'Stored document draft generated for this application run'}
                </span>
              </div>
              {selectedApplication.coverLetterDocument?.url && (
                <a
                  className="application-detail-generated-resume-link"
                  href={selectedApplication.coverLetterDocument.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open Cover Letter Document
                </a>
              )}
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
                <span>
                  {isEnrichingApplication
                    ? 'Refreshing the stored description from the listing'
                    : 'Stored with the application snapshot'}
                </span>
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
