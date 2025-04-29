import React, { useState } from 'react';
import ResumeUploader from './components/ResumeUploader';
import SearchTerms from './components/SearchTerms';
import JobList from './components/JobList';
import useJobSearch from './hooks/useJobSearch';
import './styles/App.css';

const App: React.FC = () => {
  const [
    { resume, searchTerms, jobs, favoriteJobs, isLoading, error },
    { uploadResume, searchJobs, toggleFavorite, evaluateMatch }
  ] = useJobSearch();

  return (
    <div className="app">
      <header className="app-header">
        <h1>Job Finder</h1>
        <p>Upload your resume to find matching jobs with just a few clicks</p>
      </header>

      <main className="app-main">
        {error && <div className="error-banner">{error}</div>}

        <div className="resume-section">
          <h2>Resume</h2>
          {resume ? (
            <div className="resume-info">
              <div className="resume-file-info">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                  <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
                <div>
                  <p className="file-name">{resume.fileName}</p>
                </div>
              </div>
            </div>
          ) : (
            <ResumeUploader onUpload={uploadResume} isLoading={isLoading} />
          )}
        </div>

        {resume && (
          <>
            <div className="search-section">
              <SearchTerms 
                terms={searchTerms} 
                onSearch={searchJobs} 
                isLoading={isLoading} 
              />
            </div>

            <div className="results-section">
              <JobList
                jobs={jobs}
                favoriteJobs={favoriteJobs}
                toggleFavorite={toggleFavorite}
                evaluateMatch={evaluateMatch}
                isLoading={isLoading}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default App; 