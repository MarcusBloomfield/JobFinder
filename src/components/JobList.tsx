import React from 'react';
import { Job } from '../models/Job';

interface JobListProps {
  jobs: Job[];
  evaluateMatch: (jobId: string) => Promise<void>;
  isLoading: boolean;
}

const JobList: React.FC<JobListProps> = ({
  jobs,
  evaluateMatch,
  isLoading
}) => {
  const handleJobClick = (job: Job) => {
    window.open(job.url, '_blank', 'noopener,noreferrer');
  };

  const getMatchColor = (score?: number) => {
    if (!score) return '';
    if (score >= 80) return 'match-high';
    if (score >= 60) return 'match-medium';
    return 'match-low';
  };

  return (
    <div className="job-list-container">
      <div className="job-list-header">
        <h3>Jobs {jobs.length > 0 && `(${jobs.length})`}</h3>
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
                  className="job-card"
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
                  
                  <div className="job-card-footer">
                    <span className="view-details">Visit Job Site</span>
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