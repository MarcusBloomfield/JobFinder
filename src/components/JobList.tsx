import React, { useState } from 'react';
import { Job } from '../models/Job';

interface JobListProps {
  jobs: Job[];
  evaluateMatch: (jobId: string) => Promise<void>;
  applyToJob: (jobId: string) => Promise<void>;
  autoApplyMatchingJobs: () => Promise<void>;
  isLoading: boolean;
  isBulkAutoApplying: boolean;
}

const JobList: React.FC<JobListProps> = ({
  jobs,
  evaluateMatch,
  applyToJob,
  autoApplyMatchingJobs,
  isLoading,
  isBulkAutoApplying
}) => {
  const [visitedJobIds, setVisitedJobIds] = useState<Set<string>>(new Set());
  const eligibleAutoApplyCount = jobs.filter(
    (job) =>
      (job.matchScore || 0) >= 60 &&
      job.applicationStatus !== 'applied' &&
      job.applicationStatus !== 'applying' &&
      job.applicationStatus !== 'skipped'
  ).length;

  const handleJobClick = (job: Job) => {
    setVisitedJobIds((prev) => {
      const next = new Set(prev);
      next.add(job.id);
      return next;
    });
    window.open(job.url, '_blank', 'noopener,noreferrer');
  };

  const getMatchColor = (score?: number) => {
    if (score === undefined || score === null) return '';
    if (score >= 80) return 'match-high';
    if (score >= 60) return 'match-medium';
    return 'match-low';
  };

  const getApplicationStatusClass = (status?: Job['applicationStatus']) => {
    switch (status) {
      case 'applied':
        return 'application-status applied';
      case 'review_required':
        return 'application-status review-required';
      case 'failed':
        return 'application-status failed';
      case 'skipped':
        return 'application-status skipped';
      case 'applying':
        return 'application-status applying';
      default:
        return 'application-status';
    }
  };

  return (
    <div className="job-list-container">
      <div className="job-list-header">
        <h3>Jobs {jobs.length > 0 && `(${jobs.length})`}</h3>
        {jobs.length > 0 && (
          <div className="job-list-header-actions">
            <span className="bulk-auto-apply-summary">
              {eligibleAutoApplyCount} jobs at 60%+ match
            </span>
            <button
              className="bulk-auto-apply-button"
              disabled={isLoading || isBulkAutoApplying || eligibleAutoApplyCount === 0}
              onClick={() => void autoApplyMatchingJobs()}
            >
              {isBulkAutoApplying ? 'Auto Applying 60%+ Matches...' : 'Fully Auto Apply 60%+'}
            </button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="loading-indicator">
          <div className="spinner"></div>
          <p>Searching for jobs...</p>
        </div>
      ) : (
        <>
          {jobs.length > 0 ? (
            <div className="job-list">
              {jobs.map((job) => (
                <div 
                  key={job.id} 
                  className={`job-card ${visitedJobIds.has(job.id) ? 'visited' : ''}`}
                  onClick={() => handleJobClick(job)}
                >
                  <div className="job-header">
                    <h4 className="job-title">{job.title}</h4>
                  </div>
                  <div className="job-company">{job.company}</div>
                  {job.location && <div className="job-location">{job.location}</div>}
                  
                  {job.matchScore !== undefined && (
                    <div className={`job-match ${getMatchColor(job.matchScore)}`}>
                      Match: {job.matchScore}%
                    </div>
                  )}
                  
                  <div className="job-description-preview">
                    {job.description.substring(0, 150)}
                    {job.description.length > 150 && '...'}
                  </div>

                  <div className="job-card-actions">
                    <button
                      className="auto-apply-button"
                      disabled={job.applicationStatus === 'applying' || isBulkAutoApplying}
                      onClick={(event) => {
                        event.stopPropagation();
                        void applyToJob(job.id);
                      }}
                    >
                      {job.applicationStatus === 'applying'
                        ? 'Applying...'
                        : isBulkAutoApplying
                          ? 'Batch Running...'
                          : 'Auto Apply'}
                    </button>
                    {job.applicationStatus && job.applicationStatus !== 'idle' && (
                      <div className={getApplicationStatusClass(job.applicationStatus)}>
                        {job.applicationStatus === 'review_required'
                          ? 'Needs Review'
                          : job.applicationStatus === 'skipped'
                            ? 'Skipped'
                          : job.applicationStatus.charAt(0).toUpperCase() + job.applicationStatus.slice(1)}
                      </div>
                    )}
                  </div>

                  {job.applicationMessage && (
                    <div className="application-message">{job.applicationMessage}</div>
                  )}

                  {job.applicationLogs && job.applicationLogs.length > 0 && (
                    <details
                      className="application-logs"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <summary>Application Log</summary>
                      <ul>
                        {job.applicationLogs.map((log, index) => (
                          <li key={`${job.id}-log-${index}`}>{log}</li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {job.applicationArtifacts && job.applicationArtifacts.length > 0 && (
                    <details
                      className="application-artifacts"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <summary>Screenshots</summary>
                      <div className="application-artifact-grid">
                        {job.applicationArtifacts.map((artifact, index) => (
                          <a
                            key={`${job.id}-artifact-${index}`}
                            className="application-artifact-card"
                            href={artifact.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <img
                              src={artifact.url}
                              alt={artifact.label}
                              loading="lazy"
                            />
                            <span>{artifact.label}</span>
                          </a>
                        ))}
                      </div>
                    </details>
                  )}
                  
                  <div className="job-card-footer">
                    <span className={`view-details ${visitedJobIds.has(job.id) ? 'visited' : ''}`}>Visit Job Site</span>
                    {job.datePosted && <span className="job-date">{job.datePosted}</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="no-jobs-message">
              <p>No jobs found. Try searching with different terms.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default JobList; 
