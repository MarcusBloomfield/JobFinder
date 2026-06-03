import { Request, Response } from 'express';
import { JobDetails, normalizeJobDetails } from '../models/JobDetails';
import * as applicationTrackingService from '../services/applicationTrackingService';

const parsePositiveInteger = (value: unknown, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }

  return fallback;
};

const getMissingRequiredJobDetailsLabels = (jobDetails: JobDetails): string[] => {
  const missingFields: string[] = [];

  if (!jobDetails.employerName) {
    missingFields.push('Employer name');
  }

  if (!jobDetails.jobTitle) {
    missingFields.push('Job title');
  }

  if (!jobDetails.suburbOrPostcode) {
    missingFields.push('Suburb or postcode');
  }

  if (!jobDetails.applicationMethod) {
    missingFields.push('How did you apply');
  }

  if (!jobDetails.applicationSubmittedDate) {
    missingFields.push('Application submitted date');
  }

  return missingFields;
};

export const getApplicationHistory = (req: Request, res: Response) => {
  try {
    const limit = parsePositiveInteger(req.query.limit, 20);
    const data = applicationTrackingService.listTrackedApplications(limit);

    res.status(200).json({
      error: false,
      data
    });
  } catch (error) {
    console.error('Error in getApplicationHistory controller:', error);
    res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};

export const getApplicationSummary = (req: Request, res: Response) => {
  try {
    const days = parsePositiveInteger(req.query.days, 14);
    const recentLimit = parsePositiveInteger(req.query.recentLimit, 8);
    const data = applicationTrackingService.getApplicationTrackingSummary(days, recentLimit);

    res.status(200).json({
      error: false,
      data
    });
  } catch (error) {
    console.error('Error in getApplicationSummary controller:', error);
    res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};

export const getApplicationStatusesForJobs = (req: Request, res: Response) => {
  try {
    const { jobUrls } = req.body as { jobUrls?: unknown };

    if (!Array.isArray(jobUrls) || !jobUrls.every(jobUrl => typeof jobUrl === 'string')) {
      return res.status(400).json({
        error: true,
        message: 'Invalid request body. Expected jobUrls: string[].'
      });
    }

    const data = applicationTrackingService.getTrackedApplicationsByJobUrls(jobUrls);

    res.status(200).json({
      error: false,
      data
    });
  } catch (error) {
    console.error('Error in getApplicationStatusesForJobs controller:', error);
    res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};

export const updateTrackedApplicationJobDetails = (req: Request, res: Response) => {
  try {
    const { applicationId } = req.params as { applicationId?: string };
    const { jobDetails } = req.body as { jobDetails?: Partial<JobDetails> };

    if (!applicationId || typeof applicationId !== 'string') {
      return res.status(400).json({
        error: true,
        message: 'Missing or invalid applicationId route parameter.'
      });
    }

    if (!jobDetails || typeof jobDetails !== 'object') {
      return res.status(400).json({
        error: true,
        message: 'Invalid request body. Expected jobDetails object.'
      });
    }

    const normalizedJobDetails = normalizeJobDetails(jobDetails);
    const missingFields = getMissingRequiredJobDetailsLabels(normalizedJobDetails);

    if (missingFields.length > 0) {
      return res.status(400).json({
        error: true,
        message: `Missing required job details: ${missingFields.join(', ')}.`
      });
    }

    const data = applicationTrackingService.updateTrackedApplicationJobDetails(
      applicationId,
      normalizedJobDetails
    );

    if (!data) {
      return res.status(404).json({
        error: true,
        message: 'Tracked application not found.'
      });
    }

    res.status(200).json({
      error: false,
      data
    });
  } catch (error) {
    console.error('Error in updateTrackedApplicationJobDetails controller:', error);
    res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};

export const enrichTrackedApplicationFromListing = async (req: Request, res: Response) => {
  try {
    const { applicationId } = req.params as { applicationId?: string };

    if (!applicationId || typeof applicationId !== 'string') {
      return res.status(400).json({
        error: true,
        message: 'Missing or invalid applicationId route parameter.'
      });
    }

    const data = await applicationTrackingService.enrichTrackedApplicationFromListing(applicationId);

    if (!data) {
      return res.status(404).json({
        error: true,
        message: 'Tracked application not found.'
      });
    }

    res.status(200).json({
      error: false,
      data
    });
  } catch (error) {
    console.error('Error in enrichTrackedApplicationFromListing controller:', error);
    res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};
