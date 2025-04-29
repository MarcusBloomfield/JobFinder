import { useState, useEffect } from 'react';
import { Resume } from '../models/Resume';
import { Job } from '../models/Job';
import { parseResume } from '../services/resumeParserService';
import { generateSearchTerms, evaluateJobMatch } from '../services/openAiService';
import { scrapeJobs } from '../services/scrapeService';

interface JobSearchState {
  resume: Resume | null;
  searchTerms: string[];
  jobs: Job[];
  favoriteJobs: Job[];
  isLoading: boolean;
  error: string | null;
}

interface JobSearchActions {
  uploadResume: (file: File) => Promise<void>;
  searchJobs: (customTerms?: string[]) => Promise<void>;
  toggleFavorite: (jobId: string) => void;
  evaluateMatch: (jobId: string) => Promise<void>;
}

const useJobSearch = (): [JobSearchState, JobSearchActions] => {
  const [resume, setResume] = useState<Resume | null>(null);
  const [searchTerms, setSearchTerms] = useState<string[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [favoriteJobs, setFavoriteJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Load saved jobs from localStorage on initial render
  useEffect(() => {
    try {
      const savedFavorites = localStorage.getItem('favoriteJobs');
      if (savedFavorites) {
        setFavoriteJobs(JSON.parse(savedFavorites));
      }
    } catch (error) {
      console.error('Error loading saved jobs:', error);
    }
  }, []);

  // Save favorite jobs to localStorage when they change
  useEffect(() => {
    if (favoriteJobs.length > 0) {
      localStorage.setItem('favoriteJobs', JSON.stringify(favoriteJobs));
    }
  }, [favoriteJobs]);

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
      
      // Scrape jobs using the search terms
      const scrapedJobs = await scrapeJobs(termsToUse, ['seek', 'indeed'], 2);
      setJobs(scrapedJobs);
      
      // If resume is available, evaluate match scores for each job
      if (resume) {
        const jobsWithScores = await Promise.all(
          scrapedJobs.map(async (job) => {
            const matchScore = await evaluateJobMatch(job, resume);
            return { ...job, matchScore };
          })
        );
        
        // Sort by match score (highest first)
        jobsWithScores.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
        setJobs(jobsWithScores);
      }
      
      setIsLoading(false);
    } catch (error) {
      setError('Failed to search for jobs');
      setIsLoading(false);
      console.error('Job search error:', error);
    }
  };

  const toggleFavorite = (jobId: string): void => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;

    if (favoriteJobs.some(j => j.id === jobId)) {
      // Remove from favorites
      setFavoriteJobs(favoriteJobs.filter(j => j.id !== jobId));
    } else {
      // Add to favorites
      setFavoriteJobs([...favoriteJobs, { ...job, isFavorite: true }]);
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
      
      // Also update in favorites if present
      if (favoriteJobs.some(j => j.id === jobId)) {
        setFavoriteJobs(favoriteJobs.map(j => 
          j.id === jobId ? { ...j, matchScore } : j
        ));
      }
      
      setIsLoading(false);
    } catch (error) {
      console.error('Match evaluation error:', error);
      setIsLoading(false);
    }
  };

  return [
    { resume, searchTerms, jobs, favoriteJobs, isLoading, error },
    { uploadResume, searchJobs, toggleFavorite, evaluateMatch }
  ];
};

export default useJobSearch; 