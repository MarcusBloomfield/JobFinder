import { Request, Response } from 'express';
import { Job } from '../models/Job';
import { Resume } from '../models/Resume';
import * as applicationAgentService from '../services/applicationAgentService';

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

const validateResume = (resume: any): resume is Resume => {
  return (
    resume &&
    typeof resume.id === 'string' &&
    typeof resume.fileName === 'string' &&
    (resume.fileType === 'pdf' || resume.fileType === 'docx') &&
    typeof resume.content === 'string'
  );
};

export const applyToJob = async (req: Request, res: Response) => {
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

    const result = await applicationAgentService.applyToJob(job, resume);

    res.status(200).json({
      error: false,
      message: result.message,
      data: result
    });
  } catch (error) {
    console.error('Error in applyToJob controller:', error);
    res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};

export const openSeekLoginBrowser = async (_req: Request, res: Response) => {
  try {
    const result = await applicationAgentService.openSeekLoginBrowser();

    res.status(200).json({
      error: false,
      message: result.message,
      data: result
    });
  } catch (error) {
    console.error('Error in openSeekLoginBrowser controller:', error);
    res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};
