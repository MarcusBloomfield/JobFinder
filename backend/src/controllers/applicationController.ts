import { Request, Response } from 'express';
import { Job } from '../models/Job';
import { Resume } from '../models/Resume';
import { ApplicationProfile, DriversLicenceStatus, WorkRightsStatus } from '../models/ApplicationProfile';
import * as applicationAgentService from '../services/applicationAgentService';
import {
  ApplicationTriggerSource,
  createTrackedApplication,
  failTrackedApplication,
  finalizeTrackedApplication
} from '../services/applicationTrackingService';

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

const WORK_RIGHTS_STATUSES: WorkRightsStatus[] = [
  '',
  'australian_citizen_or_permanent_resident',
  'temporary_visa_with_work_rights',
  'require_employer_sponsorship',
  'other'
];

const DRIVERS_LICENCE_STATUSES: DriversLicenceStatus[] = ['', 'full', 'provisional_or_learner', 'none'];
const APPLICATION_TRIGGER_SOURCES: ApplicationTriggerSource[] = ['manual', 'bulk'];

const validateApplicationProfile = (profile: any): profile is ApplicationProfile | undefined => {
  if (profile === undefined || profile === null) {
    return true;
  }

  return (
    typeof profile === 'object' &&
    WORK_RIGHTS_STATUSES.includes(profile.workRightsStatus) &&
    typeof profile.workRightsDetails === 'string' &&
    DRIVERS_LICENCE_STATUSES.includes(profile.driversLicenceStatus) &&
    typeof profile.salaryExpectationAnnual === 'string' &&
    typeof profile.employerQuestionNotes === 'string'
  );
};

export const applyToJob = async (req: Request, res: Response) => {
  let trackedApplicationId: string | null = null;

  try {
    const { job, resume, applicationProfile, triggerSource } = req.body;

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

    if (!validateApplicationProfile(applicationProfile)) {
      return res.status(400).json({
        error: true,
        message:
          'Invalid applicationProfile object. Expected work rights, driver licence, salary, and notes fields.'
      });
    }

    if (
      triggerSource !== undefined &&
      (!APPLICATION_TRIGGER_SOURCES.includes(triggerSource) || typeof triggerSource !== 'string')
    ) {
      return res.status(400).json({
        error: true,
        message: 'Invalid triggerSource. Expected "manual" or "bulk".'
      });
    }

    const trackedApplication = createTrackedApplication(
      job,
      resume,
      applicationProfile,
      triggerSource || 'manual'
    );
    trackedApplicationId = trackedApplication.id;
    const result = await applicationAgentService.applyToJob(job, resume, applicationProfile);
    finalizeTrackedApplication(trackedApplication.id, result);

    res.status(200).json({
      error: false,
      message: result.message,
      data: {
        ...result,
        trackingId: trackedApplication.id
      }
    });
  } catch (error) {
    console.error('Error in applyToJob controller:', error);

    if (trackedApplicationId) {
      failTrackedApplication(
        trackedApplicationId,
        error instanceof Error ? error.message : 'An unknown error occurred'
      );
    }

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
