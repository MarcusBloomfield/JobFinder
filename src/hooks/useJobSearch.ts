import { useState, useEffect } from 'react';
import { Resume } from '../models/Resume';
import { Job } from '../models/Job';
import { JobDetails } from '../models/JobDetails';
import {
  ApplicationProfile,
  DEFAULT_APPLICATION_PROFILE,
  normalizeApplicationProfile
} from '../models/ApplicationProfile';
import {
  ApplicationProgressStage,
  ApplicationTrackingSummary,
  ApplicationTriggerSource,
  TrackedJobApplication
} from '../models/ApplicationTracking';
import { getStoredResume, listStoredResumes, parseResume } from '../services/resumeParserService';
import { parseCoverLetterExample } from '../services/coverLetterExampleService';
import { generateSearchTerms, evaluateJobMatch, evaluateJobMatchesBulk } from '../services/openAiService';
import { scrapeJobs } from '../services/scrapeService';
import {
  applyToJob as autoApplyToJob,
  fetchApplicationHistory,
  fetchApplicationStatusesForJobs,
  fetchApplicationTrackingSummary,
  enrichTrackedApplicationFromListing,
  fillApplicationProfileWithAi,
  normalizeTrackedJobUrl,
  openSeekLoginBrowser,
  updateTrackedApplicationProgressStage,
  updateApplicationJobDetails
} from '../services/applicationService';

interface JobSearchState {
  resume: Resume | null;
  storedResumes: Resume[];
  searchTerms: string[];
  jobs: Job[];
  isLoading: boolean;
  isBulkAutoApplying: boolean;
  error: string | null;
  location: string;
  jobSearchAmount: number;
  seekLoginMessage: string | null;
  isSeekLoginLoading: boolean;
  isStoredResumesLoading: boolean;
  applicationProfile: ApplicationProfile;
  applicationTrackingSummary: ApplicationTrackingSummary | null;
  applicationHistory: TrackedJobApplication[];
  isApplicationTrackingLoading: boolean;
  isProfileFillLoading: boolean;
  isCoverLetterExampleLoading: boolean;
  profileFillMessage: string | null;
}

interface JobSearchActions {
  uploadResume: (file: File) => Promise<void>;
  selectStoredResume: (resumeId: string) => Promise<void>;
  searchJobs: (customTerms?: string[]) => Promise<void>;
  searchJobsNoAI: (customTerms?: string[]) => Promise<void>;
  evaluateMatch: (jobId: string) => Promise<void>;
  applyToJob: (jobId: string) => Promise<void>;
  autoApplyMatchingJobs: () => Promise<void>;
  loginToSeek: () => Promise<void>;
  setLocation: (location: string) => void;
  setJobSearchAmount: (amount: number) => void;
  updateApplicationProfile: (updates: Partial<ApplicationProfile>) => void;
  uploadCoverLetterExample: (file: File) => Promise<void>;
  removeCoverLetterExample: (exampleId: string) => void;
  fillApplicationProfileFromResumes: () => Promise<void>;
  refreshApplicationTracking: () => Promise<void>;
  updateTrackedApplicationJobDetails: (applicationId: string, jobDetails: JobDetails) => Promise<void>;
  updateTrackedApplicationProgress: (
    applicationId: string,
    stage: ApplicationProgressStage
  ) => Promise<void>;
  enrichTrackedApplication: (applicationId: string) => Promise<void>;
}

interface ApplyRunOutcome {
  shouldStopBatch: boolean;
  stopReason?: string;
}

const getPageLimitForMaxJobs = (maxJobs: number): number => {
  return Math.max(1, Math.min(10, Math.ceil(maxJobs / 20)));
};

const APPLICATION_PROFILE_STORAGE_KEY = 'jobfinder.applicationProfile';

const loadStoredApplicationProfile = (): ApplicationProfile => {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_APPLICATION_PROFILE };
  }

  try {
    const raw = window.localStorage.getItem(APPLICATION_PROFILE_STORAGE_KEY);
    return raw ? normalizeApplicationProfile(JSON.parse(raw)) : { ...DEFAULT_APPLICATION_PROFILE };
  } catch {
    return { ...DEFAULT_APPLICATION_PROFILE };
  }
};

const isFatalBatchApplyErrorMessage = (message: string): boolean => {
  const normalized = message.toLowerCase();

  return (
    normalized.includes('429') ||
    normalized.includes('quota') ||
    normalized.includes('billing') ||
    normalized.includes('insufficient_quota') ||
    normalized.includes('rate limit') ||
    normalized.includes('openai api key is not configured') ||
    normalized.includes('incorrect api key') ||
    normalized.includes('invalid api key') ||
    normalized.includes('401')
  );
};

const buildBatchStopMessage = (reason: string): string =>
  `Fully automatic apply stopped because the application service hit a blocking upstream error: ${reason}`;

const mergeTrackedApplicationIntoJob = (job: Job, trackedApplication?: TrackedJobApplication): Job => {
  if (!trackedApplication) {
    return {
      ...job,
      applicationStatus: job.applicationStatus || 'idle'
    };
  }

  return {
    ...job,
    applicationStatus: trackedApplication.status,
    applicationMessage: trackedApplication.message,
    applicationLogs: trackedApplication.logs,
    applicationArtifacts: trackedApplication.artifacts,
    applicationTrackingId: trackedApplication.id,
    applicationUpdatedAt: trackedApplication.updatedAt
  };
};

const useJobSearch = (): [JobSearchState, JobSearchActions] => {
  const [resume, setResume] = useState<Resume | null>(null);
  const [storedResumes, setStoredResumes] = useState<Resume[]>([]);
  const [searchTerms, setSearchTerms] = useState<string[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isBulkAutoApplying, setIsBulkAutoApplying] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState<string>('Australia');
  const [jobSearchAmount, setJobSearchAmount] = useState<number>(25);
  const [seekLoginMessage, setSeekLoginMessage] = useState<string | null>(null);
  const [isSeekLoginLoading, setIsSeekLoginLoading] = useState<boolean>(false);
  const [isStoredResumesLoading, setIsStoredResumesLoading] = useState<boolean>(false);
  const [applicationProfile, setApplicationProfile] = useState<ApplicationProfile>(() =>
    loadStoredApplicationProfile()
  );
  const [applicationTrackingSummary, setApplicationTrackingSummary] =
    useState<ApplicationTrackingSummary | null>(null);
  const [applicationHistory, setApplicationHistory] = useState<TrackedJobApplication[]>([]);
  const [isApplicationTrackingLoading, setIsApplicationTrackingLoading] = useState<boolean>(false);
  const [isProfileFillLoading, setIsProfileFillLoading] = useState<boolean>(false);
  const [isCoverLetterExampleLoading, setIsCoverLetterExampleLoading] = useState<boolean>(false);
  const [profileFillMessage, setProfileFillMessage] = useState<string | null>(null);

  const upsertStoredResume = (nextResume: Resume): void => {
    setStoredResumes(currentResumes => {
      const deduped = currentResumes.filter(currentResume => currentResume.id !== nextResume.id);
      return [nextResume, ...deduped].sort((left, right) => {
        const leftTime = left.uploadedAt ? new Date(left.uploadedAt).getTime() : 0;
        const rightTime = right.uploadedAt ? new Date(right.uploadedAt).getTime() : 0;
        return rightTime - leftTime;
      });
    });
  };

  const activateResume = async (nextResume: Resume): Promise<void> => {
    setResume(nextResume);
    setJobs([]);
    setError(null);

    if (nextResume.generatedSearchTerms && nextResume.generatedSearchTerms.length > 0) {
      setSearchTerms(nextResume.generatedSearchTerms);
      upsertStoredResume(nextResume);
      return;
    }

    try {
      const terms = await generateSearchTerms(nextResume);
      const hydratedResume = { ...nextResume, generatedSearchTerms: terms };
      setResume(hydratedResume);
      setSearchTerms(terms);
      upsertStoredResume(hydratedResume);
    } catch (error) {
      setSearchTerms([]);
      setError('Resume loaded, but failed to generate search terms');
      console.error('Search term generation error:', error);
    }
  };

  const loadApplicationTrackingData = async (): Promise<void> => {
    setIsApplicationTrackingLoading(true);
    try {
      const [summary, history] = await Promise.all([
        fetchApplicationTrackingSummary(),
        fetchApplicationHistory(50)
      ]);
      setApplicationTrackingSummary(summary);
      setApplicationHistory(history);
    } catch (error) {
      console.error('Application tracking loading error:', error);
    } finally {
      setIsApplicationTrackingLoading(false);
    }
  };

  const syncTrackedApplicationIntoJobs = (updatedApplication: TrackedJobApplication): void => {
    const normalizedUpdatedUrl = normalizeTrackedJobUrl(updatedApplication.jobUrl);

    setJobs(currentJobs =>
      currentJobs.map(job =>
        job.applicationTrackingId === updatedApplication.id ||
        normalizeTrackedJobUrl(job.url) === normalizedUpdatedUrl
          ? mergeTrackedApplicationIntoJob(job, updatedApplication)
          : job
      )
    );
  };

  const hydrateJobsWithTrackedApplications = async (scrapedJobs: Job[]): Promise<Job[]> => {
    const initialJobs = scrapedJobs.map(job => ({
      ...job,
      applicationStatus: job.applicationStatus || 'idle'
    }));

    try {
      const trackedApplicationsByUrl = await fetchApplicationStatusesForJobs(
        initialJobs.map(job => job.url)
      );

      return initialJobs.map(job =>
        mergeTrackedApplicationIntoJob(job, trackedApplicationsByUrl.get(normalizeTrackedJobUrl(job.url)))
      );
    } catch (error) {
      console.error('Tracked application lookup error:', error);
      return initialJobs;
    }
  };

  useEffect(() => {
    const loadStoredResumes = async (): Promise<void> => {
      setIsStoredResumesLoading(true);
      try {
        const resumes = await listStoredResumes();
        setStoredResumes(resumes);
      } catch (error) {
        console.error('Stored resume loading error:', error);
      } finally {
        setIsStoredResumesLoading(false);
      }
    };

    void loadStoredResumes();
    void loadApplicationTrackingData();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      APPLICATION_PROFILE_STORAGE_KEY,
      JSON.stringify(normalizeApplicationProfile(applicationProfile))
    );
  }, [applicationProfile]);

  const uploadResume = async (file: File): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const parsedResume = await parseResume(file);
      upsertStoredResume(parsedResume);
      await activateResume(parsedResume);
      setIsLoading(false);
    } catch (error) {
      setError('Failed to upload or parse resume');
      setIsLoading(false);
      console.error('Resume upload error:', error);
    }
  };

  const selectStoredResume = async (resumeId: string): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      const storedResume = await getStoredResume(resumeId);
      await activateResume(storedResume);
      setIsLoading(false);
    } catch (error) {
      setError('Failed to load stored resume');
      setIsLoading(false);
      console.error('Stored resume selection error:', error);
    }
  };

  const searchJobs = async (customTerms?: string[]): Promise<void> => {
    if (!resume && !customTerms) {
      setError('Please upload a resume or provide search terms');
      return;
    }

    setIsLoading(true);
    setError(null);
    
    try {
      const termsToUse = customTerms || searchTerms;
      if (!termsToUse.length) {
        throw new Error('No search terms available');
      }
      
      // Scrape jobs using the search terms and location
      const scrapedJobs = await scrapeJobs(
        termsToUse,
        ['seek'],
        getPageLimitForMaxJobs(jobSearchAmount),
        location,
        jobSearchAmount
      );
      
      // If resume is available, evaluate match scores for all jobs at once
      if (resume) {
        console.log(`Evaluating match scores for ${scrapedJobs.length} jobs in bulk`);
        
        // Use the bulk evaluation service to process all jobs at once
        const matchScores = await evaluateJobMatchesBulk(scrapedJobs, resume);
        
        // Apply match scores to the jobs
        const jobsWithScores = scrapedJobs.map(job => ({
          ...job,
          matchScore: matchScores[job.id] || 0,
          applicationStatus: 'idle' as const
        }));

        const hydratedJobs = await hydrateJobsWithTrackedApplications(jobsWithScores);

        // Sort by match score (highest first)
        hydratedJobs.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
        setJobs(hydratedJobs);
      } else {
        setJobs(await hydrateJobsWithTrackedApplications(scrapedJobs));
      }
      
      setIsLoading(false);
    } catch (error) {
      setError('Failed to search for jobs');
      setIsLoading(false);
      console.error('Job search error:', error);
    }
  };

  const searchJobsNoAI = async (customTerms?: string[]): Promise<void> => {
    const termsToUse = customTerms || searchTerms;
    if (!termsToUse.length) {
      setError('Please provide search terms');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const scrapedJobs = await scrapeJobs(
        termsToUse,
        ['seek'],
        getPageLimitForMaxJobs(jobSearchAmount),
        location,
        jobSearchAmount
      );
      setJobs(await hydrateJobsWithTrackedApplications(scrapedJobs));
      setIsLoading(false);
    } catch (error) {
      setError('Failed to search for jobs');
      setIsLoading(false);
      console.error('Job search error:', error);
    }
  };

  const evaluateMatch = async (jobId: string): Promise<void> => {
    if (!resume) {
      setError('Please upload a resume first');
      return;
    }

    const job = jobs.find(j => j.id === jobId);
    if (!job) return;

    setIsLoading(true);
    try {
      const matchScore = await evaluateJobMatch(job, resume);
      
      // Update the job with the match score
      setJobs(jobs.map(j => 
        j.id === jobId ? { ...j, matchScore } : j
      ));
      
      setIsLoading(false);
    } catch (error) {
      console.error('Match evaluation error:', error);
      setIsLoading(false);
    }
  };

  const applyToJobInternal = async (
    job: Job,
    activeResume: Resume,
    triggerSource: ApplicationTriggerSource
  ): Promise<ApplyRunOutcome> => {
    setError(null);
    setJobs(currentJobs =>
      currentJobs.map(currentJob =>
        currentJob.id === job.id
          ? {
              ...currentJob,
              applicationStatus: 'applying',
              applicationMessage: 'Launching application agent...',
              applicationLogs: [],
              applicationArtifacts: []
            }
          : currentJob
      )
    );

    try {
      const result = await autoApplyToJob(job, activeResume, applicationProfile, triggerSource);
      const updatedAt = new Date().toISOString();

      setJobs(currentJobs =>
        currentJobs.map(currentJob =>
          currentJob.id === job.id
            ? {
                ...currentJob,
                applicationStatus: result.status,
                applicationMessage: result.message,
                applicationLogs: result.logs,
                applicationArtifacts: result.artifacts,
                applicationTrackingId: result.trackingId,
                applicationUpdatedAt: updatedAt
              }
            : currentJob
        )
      );

      await loadApplicationTrackingData();

      return {
        shouldStopBatch: result.status === 'failed' && isFatalBatchApplyErrorMessage(result.message),
        stopReason: result.status === 'failed' ? result.message : undefined
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to auto-apply for this job';

      setJobs(currentJobs =>
        currentJobs.map(currentJob =>
          currentJob.id === job.id
            ? {
                ...currentJob,
                applicationStatus: 'failed',
                applicationMessage: message,
                applicationArtifacts: [],
                applicationUpdatedAt: new Date().toISOString()
              }
            : currentJob
        )
      );
      console.error('Auto-apply error:', error);
      await loadApplicationTrackingData();

      return {
        shouldStopBatch: isFatalBatchApplyErrorMessage(message),
        stopReason: message
      };
    }
  };

  const applyToJob = async (jobId: string): Promise<void> => {
    if (!resume) {
      setError('Please upload a resume first');
      return;
    }

    const job = jobs.find(j => j.id === jobId);
    if (!job) {
      return;
    }

    await applyToJobInternal(job, resume, 'manual');
  };

  const autoApplyMatchingJobs = async (): Promise<void> => {
    if (!resume) {
      setError('Please upload a resume first');
      return;
    }

    const eligibleJobs = jobs.filter(
      job =>
        (job.matchScore || 0) >= 60 &&
        job.applicationStatus !== 'applied' &&
        job.applicationStatus !== 'applying' &&
        job.applicationStatus !== 'skipped'
    );

    if (eligibleJobs.length === 0) {
      setError('No jobs with a 60% or higher match are available for fully automatic apply');
      return;
    }

    const eligibleJobIds = new Set(eligibleJobs.map(job => job.id));
    setError(null);
    setIsBulkAutoApplying(true);

    setJobs(currentJobs =>
      currentJobs.map(currentJob =>
        eligibleJobIds.has(currentJob.id)
          ? {
              ...currentJob,
              applicationMessage:
                currentJob.applicationStatus === 'applied'
                  ? currentJob.applicationMessage
                  : 'Queued for fully automatic apply...'
            }
          : currentJob
      )
    );

    try {
      for (let index = 0; index < eligibleJobs.length; index += 1) {
        const job = eligibleJobs[index];
        const outcome = await applyToJobInternal(job, resume, 'bulk');

        if (outcome.shouldStopBatch) {
          const stopReason = outcome.stopReason || 'Unknown upstream application error';
          const remainingJobIds = new Set(eligibleJobs.slice(index + 1).map(remainingJob => remainingJob.id));

          if (remainingJobIds.size > 0) {
            const batchStopMessage = buildBatchStopMessage(stopReason);
            setJobs(currentJobs =>
              currentJobs.map(currentJob =>
                remainingJobIds.has(currentJob.id)
                  ? {
                      ...currentJob,
                      applicationStatus: currentJob.applicationStatus === 'applying' ? 'idle' : currentJob.applicationStatus,
                      applicationMessage: batchStopMessage,
                      applicationLogs: [],
                      applicationArtifacts: []
                    }
                  : currentJob
              )
            );
          }

          setError(buildBatchStopMessage(stopReason));
          break;
        }
      }
    } finally {
      setIsBulkAutoApplying(false);
    }
  };

  const loginToSeek = async (): Promise<void> => {
    setError(null);
    setSeekLoginMessage(null);
    setIsSeekLoginLoading(true);

    try {
      const result = await openSeekLoginBrowser();
      setSeekLoginMessage(result.message);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to open the Seek login browser';
      setError(message);
    } finally {
      setIsSeekLoginLoading(false);
    }
  };

  const updateLocation = (newLocation: string): void => {
    setLocation(newLocation);
  };

  const updateApplicationProfile = (updates: Partial<ApplicationProfile>): void => {
    setApplicationProfile(currentProfile =>
      normalizeApplicationProfile({
        ...currentProfile,
        ...updates
      })
    );
    setProfileFillMessage(null);
  };

  const fillApplicationProfileFromResumes = async (): Promise<void> => {
    const resumesWithContent = storedResumes.filter(storedResume => storedResume.content.trim());

    if (resumesWithContent.length === 0) {
      setError('Upload or select at least one parsed resume before using Fill with AI');
      return;
    }

    setIsProfileFillLoading(true);
    setError(null);
    setProfileFillMessage(null);

    try {
      const result = await fillApplicationProfileWithAi(resumesWithContent, applicationProfile);
      setApplicationProfile(normalizeApplicationProfile(result.profile));
      setProfileFillMessage(
        result.updatedFields.length > 0
          ? `Filled ${result.updatedFields.length} profile field(s) from ${result.sourceResumeCount} resume(s).`
          : `No new profile fields found in ${result.sourceResumeCount} resume(s).`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fill profile with AI';
      setError(message);
      console.error('Profile fill error:', error);
    } finally {
      setIsProfileFillLoading(false);
    }
  };

  const uploadCoverLetterExample = async (file: File): Promise<void> => {
    setIsCoverLetterExampleLoading(true);
    setError(null);
    setProfileFillMessage(null);

    try {
      const example = await parseCoverLetterExample(file);
      setApplicationProfile(currentProfile =>
        normalizeApplicationProfile({
          ...currentProfile,
          coverLetterExamples: [
            example,
            ...currentProfile.coverLetterExamples.filter(currentExample => currentExample.id !== example.id)
          ].slice(0, 5)
        })
      );
      setProfileFillMessage(`Added cover letter example: ${example.fileName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload cover letter example';
      setError(message);
      console.error('Cover letter example upload error:', error);
    } finally {
      setIsCoverLetterExampleLoading(false);
    }
  };

  const removeCoverLetterExample = (exampleId: string): void => {
    setApplicationProfile(currentProfile =>
      normalizeApplicationProfile({
        ...currentProfile,
        coverLetterExamples: currentProfile.coverLetterExamples.filter(example => example.id !== exampleId)
      })
    );
    setProfileFillMessage(null);
  };

  const updateTrackedApplicationJobDetails = async (
    applicationId: string,
    jobDetails: JobDetails
  ): Promise<void> => {
    const updatedApplication = await updateApplicationJobDetails(applicationId, jobDetails);
    syncTrackedApplicationIntoJobs(updatedApplication);
    await loadApplicationTrackingData();
  };

  const updateTrackedApplicationProgress = async (
    applicationId: string,
    stage: ApplicationProgressStage
  ): Promise<void> => {
    const updatedApplication = await updateTrackedApplicationProgressStage(applicationId, stage);
    syncTrackedApplicationIntoJobs(updatedApplication);
    await loadApplicationTrackingData();
  };

  const enrichTrackedApplication = async (applicationId: string): Promise<void> => {
    const updatedApplication = await enrichTrackedApplicationFromListing(applicationId);
    syncTrackedApplicationIntoJobs(updatedApplication);

    setApplicationHistory(currentHistory =>
      currentHistory.map(application =>
        application.id === updatedApplication.id ? updatedApplication : application
      )
    );
    setApplicationTrackingSummary(currentSummary =>
      currentSummary
        ? {
            ...currentSummary,
            recentApplications: currentSummary.recentApplications.map(application =>
              application.id === updatedApplication.id ? updatedApplication : application
            )
          }
        : currentSummary
    );
  };

  return [
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
      isApplicationTrackingLoading,
      isProfileFillLoading,
      isCoverLetterExampleLoading,
      profileFillMessage
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
      setLocation: updateLocation,
      setJobSearchAmount,
      updateApplicationProfile,
      uploadCoverLetterExample,
      removeCoverLetterExample,
      fillApplicationProfileFromResumes,
      refreshApplicationTracking: loadApplicationTrackingData,
      updateTrackedApplicationJobDetails,
      updateTrackedApplicationProgress,
      enrichTrackedApplication
    }
  ];
};

export default useJobSearch; 
