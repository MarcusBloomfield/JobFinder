import React, { useEffect, useState } from 'react';
import ResumeUploader from './components/ResumeUploader';
import ApplicationProfilePanel from './components/ApplicationProfilePanel';
import ApplicationProgressPanel from './components/ApplicationProgressPanel';
import SearchTerms from './components/SearchTerms';
import LocationSelector from './components/LocationSelector';
import JobSearchAmountSelector from './components/JobSearchAmountSelector';
import JobList from './components/JobList';
import useJobSearch from './hooks/useJobSearch';
import './styles/App.css';

type AppPage = 'search' | 'progress';

const getPageFromHash = (): AppPage =>
    typeof window !== 'undefined' && window.location.hash === '#/progress' ? 'progress' : 'search';

// Main App component for the Job Finder application, providing the UI and logic integration
const App: React.FC = () => {
    const [currentPage, setCurrentPage] = useState<AppPage>(() => getPageFromHash());
    const [
        {
            resume,
            storedResumes,
            searchTerms,
            jobs,
            isLoading,
            isBulkAutoApplying,
            error,
            location,
            jobSearchAmount,
            seekLoginMessage,
            isSeekLoginLoading,
            isStoredResumesLoading,
            applicationProfile,
            applicationTrackingSummary,
            applicationHistory,
            isApplicationTrackingLoading
        },
        {
            uploadResume,
            selectStoredResume,
            searchJobs,
            searchJobsNoAI,
            evaluateMatch,
            applyToJob,
            autoApplyMatchingJobs,
            loginToSeek,
            setLocation,
            setJobSearchAmount,
            updateApplicationProfile,
            refreshApplicationTracking
        }
    ] = useJobSearch();

    useEffect(() => {
        const handleHashChange = (): void => {
            setCurrentPage(getPageFromHash());
        };

        window.addEventListener('hashchange', handleHashChange);
        return () => window.removeEventListener('hashchange', handleHashChange);
    }, []);

    const navigateToPage = (page: AppPage): void => {
        const nextHash = page === 'progress' ? '#/progress' : '#/';
        if (window.location.hash !== nextHash) {
            window.location.hash = nextHash;
            return;
        }

        setCurrentPage(page);
    };

    return (
        <div className="app">
            <header className="app-header">
                <div className="app-header-copy">
                    <h1>Job Finder</h1>
                    <p>Upload your resume to find matching jobs with just a few clicks</p>
                </div>
                <nav className="app-nav" aria-label="Primary">
                    <button
                        className={`app-nav-button ${currentPage === 'search' ? 'active' : ''}`}
                        onClick={() => navigateToPage('search')}
                    >
                        Find Jobs
                    </button>
                    <button
                        className={`app-nav-button ${currentPage === 'progress' ? 'active' : ''}`}
                        onClick={() => navigateToPage('progress')}
                    >
                        Progress
                    </button>
                </nav>
            </header>
            <main className="app-main">
                {error && <div className="error-banner">{error}</div>}

                {currentPage === 'progress' ? (
                    <ApplicationProgressPanel
                        summary={applicationTrackingSummary}
                        history={applicationHistory}
                        jobs={jobs}
                        isLoading={isApplicationTrackingLoading}
                        onRefresh={refreshApplicationTracking}
                    />
                ) : (
                    <>
                        <div className="resume-section">
                            <h2>Resume</h2>
                            <div className="seek-login-row">
                                <button
                                    className="seek-login-button"
                                    disabled={isSeekLoginLoading}
                                    onClick={() => void loginToSeek()}
                                >
                                    {isSeekLoginLoading ? 'Opening Seek Login...' : 'Login to Seek'}
                                </button>
                                {seekLoginMessage && <p className="seek-login-message">{seekLoginMessage}</p>}
                            </div>
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
                                            {resume.uploadedAt && (
                                                <p className="resume-meta">
                                                    Stored {new Date(resume.uploadedAt).toLocaleString()}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ) : null}
                            <ResumeUploader
                                onUpload={uploadResume}
                                onSelectStoredResume={selectStoredResume}
                                storedResumes={storedResumes}
                                selectedResumeId={resume?.id}
                                isLoading={isLoading}
                                isStoredResumesLoading={isStoredResumesLoading}
                            />
                        </div>

                        <ApplicationProfilePanel
                            profile={applicationProfile}
                            onChange={updateApplicationProfile}
                        />

                        {resume && (
                            <>
                                <div className="search-section">
                                    <SearchTerms
                                        terms={searchTerms}
                                        onSearch={searchJobs}
                                        onSearchNoAI={searchJobsNoAI}
                                        isLoading={isLoading}
                                    />

                                    <LocationSelector
                                        location={location}
                                        onLocationChange={setLocation}
                                        isLoading={isLoading}
                                    />

                                    <JobSearchAmountSelector
                                        amount={jobSearchAmount}
                                        onAmountChange={setJobSearchAmount}
                                        isLoading={isLoading}
                                    />
                                </div>

                                <div className="results-section">
                                    <JobList
                                        jobs={jobs}
                                        evaluateMatch={evaluateMatch}
                                        applyToJob={applyToJob}
                                        autoApplyMatchingJobs={autoApplyMatchingJobs}
                                        isLoading={isLoading}
                                        isBulkAutoApplying={isBulkAutoApplying}
                                    />
                                </div>
                            </>
                        )}
                    </>
                )}
            </main>
        </div>
    );
};

export default App; 
