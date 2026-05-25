import { useState, useEffect } from 'react';
import { Resume } from '../models/Resume';
import { Job } from '../models/Job';
import { parseResume } from '../services/resumeParserService';
import { generateSearchTerms, evaluateJobMatch, evaluateJobMatchesBulk } from '../services/openAiService';
import { scrapeJobs } from '../services/scrapeService';
import { applyToJob as autoApplyToJob, openSeekLoginBrowser } from '../services/applicationService';

interface JobSearchState {
  resume: Resume | null;
  searchTerms: string[];
  jobs: Job[];
  isLoading: boolean;
  error: string | null;
  location: string;
  jobSearchAmount: number;
  seekLoginMessage: string | null;
  isSeekLoginLoading: boolean;
}

interface JobSearchActions {
  uploadResume: (file: File) => Promise<void>;
  searchJobs: (customTerms?: string[]) => Promise<void>;
  searchJobsNoAI: (customTerms?: string[]) => Promise<void>;
  evaluateMatch: (jobId: string) => Promise<void>;
  applyToJob: (jobId: string) => Promise<void>;
  loginToSeek: () => Promise<void>;
  setLocation: (location: string) => void;
  setJobSearchAmount: (amount: number) => void;
}

const getPageLimitForMaxJobs = (maxJobs: number): number => {
  return Math.max(1, Math.min(10, Math.ceil(maxJobs / 20)));
};

const useJobSearch = (): [JobSearchState, JobSearchActions] => {
  const [resume, setResume] = useState<Resume | null>(null);
  const [searchTerms, setSearchTerms] = useState<string[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState<string>('Australia');
  const [jobSearchAmount, setJobSearchAmount] = useState<number>(25);
  const [seekLoginMessage, setSeekLoginMessage] = useState<string | null>(null);
  const [isSeekLoginLoading, setIsSeekLoginLoading] = useState<boolean>(false);

  const uploadResume = async (file: File): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const parsedResume = await parseResume(file);
      setResume(parsedResume);
      
      // Automatically generate search terms from the resume
      const terms = await generateSearchTerms(parsedResume);
      setSearchTerms(terms);
      parsedResume.generatedSearchTerms = terms;
      
      setIsLoading(false);
    } catch (error) {
      setError('Failed to upload or parse resume');
      setIsLoading(false);
      console.error('Resume upload error:', error);
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
        
        // Sort by match score (highest first)
        jobsWithScores.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
        setJobs(jobsWithScores);
      } else {
        setJobs(scrapedJobs.map(job => ({ ...job, applicationStatus: 'idle' as const })));
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
      setJobs(scrapedJobs);
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

  const applyToJob = async (jobId: string): Promise<void> => {
    if (!resume) {
      setError('Please upload a resume first');
      return;
    }

    const job = jobs.find(j => j.id === jobId);
    if (!job) {
      return;
    }

    setError(null);
    setJobs(currentJobs =>
      currentJobs.map(currentJob =>
        currentJob.id === jobId
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
      const result = await autoApplyToJob(job, resume);

      setJobs(currentJobs =>
        currentJobs.map(currentJob =>
          currentJob.id === jobId
            ? {
                ...currentJob,
                applicationStatus: result.status,
                applicationMessage: result.message,
                applicationLogs: result.logs,
                applicationArtifacts: result.artifacts
              }
            : currentJob
        )
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to auto-apply for this job';

      setJobs(currentJobs =>
        currentJobs.map(currentJob =>
          currentJob.id === jobId
            ? {
                ...currentJob,
                applicationStatus: 'failed',
                applicationMessage: message,
                applicationArtifacts: []
              }
            : currentJob
        )
      );
      console.error('Auto-apply error:', error);
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

  return [
    { resume, searchTerms, jobs, isLoading, error, location, jobSearchAmount, seekLoginMessage, isSeekLoginLoading },
    { uploadResume, searchJobs, searchJobsNoAI, evaluateMatch, applyToJob, loginToSeek, setLocation: updateLocation, setJobSearchAmount }
  ];
};

export default useJobSearch; 
