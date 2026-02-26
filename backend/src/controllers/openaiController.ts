import { Request, Response } from 'express';
import * as llmSandboxService from '../services/llmSandboxService';
import { Resume } from '../models/Resume';
import { Job } from '../models/Job';

const MAX_BULK_CONCURRENCY = 3;
const MAX_RETRIES_PER_JOB = 2;
const RETRY_BASE_DELAY_MS = 750;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const clampScore = (score: number): number => Math.max(0, Math.min(100, Math.round(score)));

const fallbackMatchScore = (job: Job, resume: Resume): number => {
  const resumeText = resume.content.toLowerCase();
  const jobText = `${job.title} ${job.company} ${job.description}`.toLowerCase();

  const resumeTokens = new Set(
    resumeText
      .split(/[^a-z0-9+#.]+/g)
      .map(token => token.trim())
      .filter(token => token.length > 2)
  );

  const jobTokens = new Set(
    jobText
      .split(/[^a-z0-9+#.]+/g)
      .map(token => token.trim())
      .filter(token => token.length > 2)
  );

  let overlap = 0;
  for (const token of jobTokens) {
    if (resumeTokens.has(token)) {
      overlap += 1;
    }
  }

  const normalized = Math.min(1, overlap / 25);
  return clampScore(35 + normalized * 65);
};

const evaluateJobWithRetries = async (
  job: Job,
  resume: Resume
): Promise<{ id: string; matchScore: number; error?: string }> => {
  for (let attempt = 0; attempt <= MAX_RETRIES_PER_JOB; attempt += 1) {
    try {
      const score = await llmSandboxService.evaluateJobMatch(job, resume);
      const normalizedScore = clampScore(score);
      console.log(`OK evaluated "${job.title}": ${normalizedScore}%`);
      return { id: job.id, matchScore: normalizedScore };
    } catch (error) {
      const isLastAttempt = attempt === MAX_RETRIES_PER_JOB;
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (isLastAttempt) {
        const fallbackScore = fallbackMatchScore(job, resume);
        console.error(`FAIL evaluated "${job.title}" after retries. Using fallback score ${fallbackScore}%. Error: ${message}`);
        return { id: job.id, matchScore: fallbackScore, error: message };
      }

      const backoff = RETRY_BASE_DELAY_MS * (attempt + 1);
      console.warn(`Retrying "${job.title}" after error: ${message}. Next attempt in ${backoff}ms`);
      await sleep(backoff);
    }
  }

  return { id: job.id, matchScore: 0, error: 'Unexpected retry state' };
};

/**
 * Generate search terms from resume
 * @route POST /api/openai/generate-search-terms
 */
export const generateSearchTerms = async (req: Request, res: Response) => {
  try {
    const { resume } = req.body;

    if (!resume) {
      return res.status(400).json({
        error: true,
        message: 'Missing required parameter: resume'
      });
    }

    if (!validateResume(resume)) {
      return res.status(400).json({
        error: true,
        message: 'Invalid resume object. Must include id, fileName, fileType, and content.'
      });
    }

    const searchTerms = await llmSandboxService.generateSearchTerms(resume);

    res.status(200).json({
      error: false,
      message: 'Search terms generated successfully',
      data: searchTerms
    });
  } catch (error) {
    console.error('Error generating search terms:', error);
    res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};

/**
 * Evaluate job match with resume
 * @route POST /api/openai/evaluate-job-match
 */
export const evaluateJobMatch = async (req: Request, res: Response) => {
  try {
    const { job, resume } = req.body;

    if (!job || !resume) {
      return res.status(400).json({
        error: true,
        message: 'Missing required parameters: job, resume'
      });
    }

    if (!validateJob(job)) {
      return res.status(400).json({
        error: true,
        message: 'Invalid job object. Must include id, title, company, description, and url.'
      });
    }

    if (!validateResume(resume)) {
      return res.status(400).json({
        error: true,
        message: 'Invalid resume object. Must include id, fileName, fileType, and content.'
      });
    }

    const matchScore = await llmSandboxService.evaluateJobMatch(job, resume);

    res.status(200).json({
      error: false,
      message: 'Job match evaluated successfully',
      data: {
        job,
        matchScore
      }
    });
  } catch (error) {
    console.error('Error evaluating job match:', error);
    res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};

/**
 * Evaluate multiple job matches in bulk
 * @route POST /api/openai/evaluate-job-matches-bulk
 */
export const evaluateJobMatchesBulk = async (req: Request, res: Response) => {
  try {
    const { jobs, resume } = req.body;

    if (!jobs || !Array.isArray(jobs) || !resume) {
      return res.status(400).json({
        error: true,
        message: 'Missing required parameters: jobs (array), resume'
      });
    }

    if (!validateResume(resume)) {
      return res.status(400).json({
        error: true,
        message: 'Invalid resume object. Must include id, fileName, fileType, and content.'
      });
    }

    const invalidJobs = jobs.filter(job => !validateJob(job));
    if (invalidJobs.length > 0) {
      return res.status(400).json({
        error: true,
        message: `Invalid job objects. ${invalidJobs.length} jobs failed validation.`
      });
    }

    console.log(`Processing bulk evaluation for ${jobs.length} jobs`);

    const results: Array<{ id: string; matchScore: number; error?: string }> = [];
    for (let i = 0; i < jobs.length; i += MAX_BULK_CONCURRENCY) {
      const batch = jobs.slice(i, i + MAX_BULK_CONCURRENCY);
      console.log(`Evaluating batch ${Math.floor(i / MAX_BULK_CONCURRENCY) + 1} with ${batch.length} jobs`);
      const batchResults = await Promise.all(batch.map(job => evaluateJobWithRetries(job, resume)));
      results.push(...batchResults);
    }

    res.status(200).json({
      error: false,
      message: `Successfully evaluated ${results.length} jobs`,
      data: results
    });
  } catch (error) {
    console.error('Error in bulk job evaluation:', error);
    res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};

/**
 * Validate resume object
 */
const validateResume = (resume: any): resume is Resume => {
  return (
    resume &&
    typeof resume.id === 'string' &&
    typeof resume.fileName === 'string' &&
    (resume.fileType === 'pdf' || resume.fileType === 'docx') &&
    typeof resume.content === 'string'
  );
};

/**
 * Validate job object
 */
const validateJob = (job: any): job is Job => {
  return (
    job &&
    typeof job.id === 'string' &&
    typeof job.title === 'string' &&
    typeof job.company === 'string' &&
    typeof job.description === 'string' &&
    typeof job.url === 'string'
  );
};
