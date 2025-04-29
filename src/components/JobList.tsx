import React, { useState } from 'react';
import { Job } from '../models/Job';
import JobDetails from './JobDetails';

interface JobListProps {
  jobs: Job[];
  favoriteJobs: Job[];
  toggleFavorite: (jobId: string) => void;
  evaluateMatch: (jobId: string) => Promise<void>;
  isLoading: boolean;
}

const JobList: React.FC<JobListProps> = ({
  jobs,
  favoriteJobs,
  toggleFavorite,
  evaluateMatch,
  isLoading
}) => {
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [showOnlyFavorites, setShowOnlyFavorites] = useState<boolean>(false);

  const handleJobClick = (job: Job) => {
    setSelectedJob(job);
  };

  const closeDetails = () => {
    setSelectedJob(null);
  };

  const handleToggleFavorite = (jobId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    toggleFavorite(jobId);
  };

  const displayedJobs = showOnlyFavorites
    ? favoriteJobs
    : jobs;

  const isJobFavorite = (jobId: string) => {
    return favoriteJobs.some(job => job.id === jobId);
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
        <h3>Jobs {jobs.length > 0 && `(${displayedJobs.length})`}</h3>
        <div className="filter-controls">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={showOnlyFavorites}
              onChange={() => setShowOnlyFavorites(!showOnlyFavorites)}
              disabled={isLoading}
            />
            <span>Show favorites only</span>
          </label>
        </div>
      </div>

      {isLoading ? (
        <div className="loading-indicator">
          <div className="spinner"></div>
          <p>Searching for jobs...</p>
        </div>
      ) : (
        <>
          {displayedJobs.length > 0 ? (
            <div className="job-list">
              {displayedJobs.map((job) => (
                <div 
                  key={job.id} 
                  className="job-card"
                  onClick={() => handleJobClick(job)}
                >
                  <div className="job-header">
                    <h4 className="job-title">{job.title}</h4>
                    <button
                      className={`favorite-button ${isJobFavorite(job.id) ? 'favorited' : ''}`}
                      onClick={(e) => handleToggleFavorite(job.id, e)}
                      aria-label={isJobFavorite(job.id) ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      {isJobFavorite(job.id) ? '★' : '☆'}
                    </button>
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
                    <span className="view-details">View Details</span>
                    {job.datePosted && <span className="job-date">{job.datePosted}</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="no-jobs-message">
              {showOnlyFavorites ? (
                <p>No favorite jobs yet. Add jobs to your favorites to see them here.</p>
              ) : (
                <p>No jobs found. Try searching with different terms.</p>
              )}
            </div>
          )}
        </>
      )}

      {selectedJob && (
        <JobDetails
          job={selectedJob}
          isFavorite={isJobFavorite(selectedJob.id)}
          onClose={closeDetails}
          onToggleFavorite={toggleFavorite}
          onEvaluateMatch={evaluateMatch}
        />
      )}
    </div>
  );
};

export default JobList; 