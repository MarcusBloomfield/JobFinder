import { Request, Response } from 'express';
import { Job } from '../models/Job';
import { Resume } from '../models/Resume';
import { ApplicationProfile, DriversLicenceStatus, WorkRightsStatus } from '../models/ApplicationProfile';
import * as applicationAgentService from '../services/applicationAgentService';
import { scrapeJobListingDetails } from '../services/scrapeService';
import {
  ApplicationTriggerSource,
  createTrackedApplication,
  enrichTrackedApplicationFromListing,
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

const shouldEnrichTrackedApplication = (application: {
  company?: string;
  description?: string;
  location?: string;
  jobDetails: {
    employerName?: string;
    jobLocation?: string;
    suburbOrPostcode?: string;
  };
} | null): boolean =>
  Boolean(
    application &&
      (
        !application.company?.trim() ||
        !application.description?.trim() ||
        !application.location?.trim() ||
        !application.jobDetails.employerName?.trim() ||
        !application.jobDetails.jobLocation?.trim() ||
        !application.jobDetails.suburbOrPostcode?.trim()
      )
  );

const normalizeOptionalText = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
};

const choosePreferredText = (
  currentValue: string | undefined,
  candidateValue: string | undefined,
  preferLongerCandidate: boolean = false
): string | undefined => {
  const current = normalizeOptionalText(currentValue);
  const candidate = normalizeOptionalText(candidateValue);

  if (!candidate) {
    return current;
  }

  if (!current) {
    return candidate;
  }

  if (preferLongerCandidate && candidate.length > current.length) {
    return candidate;
  }

  return current;
};

const hydrateJobForApplication = async (job: Job): Promise<Job> => {
  try {
    const listingDetails = await scrapeJobListingDetails(job.url);

    return {
      ...job,
      title: choosePreferredText(job.title, listingDetails.title) || job.title,
      company: choosePreferredText(job.company, listingDetails.company) || job.company,
      description:
        choosePreferredText(job.description, listingDetails.description, true) || job.description,
      location: choosePreferredText(job.location, listingDetails.location) || job.location,
      salary: choosePreferredText(job.salary, listingDetails.salary) || job.salary,
      datePosted: choosePreferredText(job.datePosted, listingDetails.datePosted) || job.datePosted
    };
  } catch (error) {
    console.error('Job listing hydration error:', error);
    return job;
  }
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

    const hydratedJob = await hydrateJobForApplication(job);

    const trackedApplication = createTrackedApplication(
      hydratedJob,
      resume,
      applicationProfile,
      triggerSource || 'manual'
    );
    trackedApplicationId = trackedApplication.id;
    const result = await applicationAgentService.applyToJob(
      hydratedJob,
      resume,
      applicationProfile
    );
    const finalizedApplication = finalizeTrackedApplication(trackedApplication.id, result);

    if (shouldEnrichTrackedApplication(finalizedApplication)) {
      try {
        await enrichTrackedApplicationFromListing(trackedApplication.id);
      } catch (enrichmentError) {
        console.error('Tracked application enrichment error:', enrichmentError);
      }
    }

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
