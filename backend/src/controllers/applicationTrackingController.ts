import { Request, Response } from 'express';
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
