import React from 'react';
import Modal from 'react-modal';
import { Job } from '../models/Job';

// Ensure Modal is properly configured for accessibility
Modal.setAppElement('#root');

interface JobDetailsProps {
  job: Job;
  isFavorite: boolean;
  onClose: () => void;
  onToggleFavorite: (jobId: string) => void;
  onEvaluateMatch: (jobId: string) => Promise<void>;
}

const JobDetails: React.FC<JobDetailsProps> = ({
  job,
  isFavorite,
  onClose,
  onToggleFavorite,
  onEvaluateMatch
}) => {
  const handleToggleFavorite = () => {
    onToggleFavorite(job.id);
  };

  const handleEvaluateMatch = () => {
    onEvaluateMatch(job.id);
  };

  const getMatchColor = (score?: number) => {
    if (!score) return '';
    if (score >= 80) return 'match-high';
    if (score >= 60) return 'match-medium';
    return 'match-low';
  };

  return (
    <Modal
      isOpen={true}
      onRequestClose={onClose}
      contentLabel="Job Details"
      className="job-details-modal"
      overlayClassName="job-details-overlay"
    >
      <div className="job-details">
        <button className="close-button" onClick={onClose}>
          ×
        </button>

        <div className="job-details-header">
          <h2 className="job-title">{job.title}</h2>
          <button
            className={`favorite-button ${isFavorite ? 'favorited' : ''}`}
            onClick={handleToggleFavorite}
          >
            {isFavorite ? '★ Favorited' : '☆ Add to Favorites'}
          </button>
        </div>

        <div className="job-meta">
          <div className="job-company">
            <strong>Company:</strong> {job.company}
          </div>
          {job.location && (
            <div className="job-location">
              <strong>Location:</strong> {job.location}
            </div>
          )}
          {job.salary && (
            <div className="job-salary">
              <strong>Salary:</strong> {job.salary}
            </div>
          )}
          {job.datePosted && (
            <div className="job-date-posted">
              <strong>Posted:</strong> {job.datePosted}
            </div>
          )}
        </div>

        {job.matchScore !== undefined ? (
          <div className={`job-match-score ${getMatchColor(job.matchScore)}`}>
            <strong>Match Score:</strong> {job.matchScore}%
          </div>
        ) : (
          <button className="evaluate-button" onClick={handleEvaluateMatch}>
            Evaluate Match
          </button>
        )}

        <div className="job-description">
          <h3>Description</h3>
          <div className="description-content">
            {job.description.split('\n').map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        </div>

        <div className="job-actions">
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="apply-button"
          >
            Apply on {new URL(job.url).hostname.replace('www.', '')}
          </a>
        </div>
      </div>
    </Modal>
  );
};

export default JobDetails; 