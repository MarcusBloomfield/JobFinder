import { Request, Response } from 'express';
import * as openaiService from '../services/openaiService';
import { Resume } from '../models/Resume';
import { Job } from '../models/Job';

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
    
    // Validate resume object
    if (!validateResume(resume)) {
      return res.status(400).json({
        error: true,
        message: 'Invalid resume object. Must include id, fileName, fileType, and content.'
      });
    }
    
    const searchTerms = await openaiService.generateSearchTerms(resume);
    
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
    
    // Validate job object
    if (!validateJob(job)) {
      return res.status(400).json({
        error: true,
        message: 'Invalid job object. Must include id, title, company, description, and url.'
      });
    }
    
    // Validate resume object
    if (!validateResume(resume)) {
      return res.status(400).json({
        error: true,
        message: 'Invalid resume object. Must include id, fileName, fileType, and content.'
      });
    }
    
    const matchScore = await openaiService.evaluateJobMatch(job, resume);
    
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
    
    // Validate resume object
    if (!validateResume(resume)) {
      return res.status(400).json({
        error: true,
        message: 'Invalid resume object. Must include id, fileName, fileType, and content.'
      });
    }
    
    // Validate job objects
    const invalidJobs = jobs.filter(job => !validateJob(job));
    if (invalidJobs.length > 0) {
      return res.status(400).json({
        error: true,
        message: `Invalid job objects. ${invalidJobs.length} jobs failed validation.`
      });
    }
    
    console.log(`Processing bulk evaluation for ${jobs.length} jobs`);
    
    // Process job evaluations in parallel
    const evaluationPromises = jobs.map(job => 
      openaiService.evaluateJobMatch(job, resume)
        .then(matchScore => ({
          id: job.id,
          matchScore
        }))
        .catch(error => {
          console.error(`Error evaluating job "${job.title}":`, error);
          return {
            id: job.id,
            matchScore: 0,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        })
    );
    
    const results = await Promise.all(evaluationPromises);
    
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