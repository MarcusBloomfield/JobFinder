import axios from 'axios';
import { Job } from '../models/Job';
import { JobDetails } from '../models/JobDetails';
import { Resume } from '../models/Resume';
import { ApplicationProfile } from '../models/ApplicationProfile';
import { AiModel } from '../models/AiSettings';
import {
  ApplicationProgressStage,
  ApplicationTrackingSummary,
  ApplicationTriggerSource,
  TrackedJobApplication
} from '../models/ApplicationTracking';

const API_URL = 'http://localhost:5000/api';

export interface JobApplicationResult {
  status: 'applied' | 'review_required' | 'failed' | 'skipped';
  message: string;
  logs: string[];
  finalUrl: string;
  steps: number;
  trackingId?: string;
  runId?: string;
  artifacts: Array<{
    step: number;
    label: string;
    filePath: string;
    url: string;
  }>;
}

export interface SeekLoginResult {
  message: string;
  profileDir: string;
  url: string;
}

export type LoginPlatform = 'seek' | 'employmenthero';

export interface ApplicationProfileFillResult {
  profile: ApplicationProfile;
  updatedFields: string[];
  sourceResumeCount: number;
}

export const applyToJob = async (
  job: Job,
  resume: Resume,
  applicationProfile: ApplicationProfile,
  triggerSource: ApplicationTriggerSource = 'manual',
  aiModel?: AiModel
): Promise<JobApplicationResult> => {
  const response = await axios.post(`${API_URL}/apply/job`, {
    job,
    resume,
    applicationProfile,
    triggerSource,
    aiModel
  });

  if (response.data && response.data.data) {
    return response.data.data as JobApplicationResult;
  }

  throw new Error('Invalid response format from apply API');
};

export const openSeekLoginBrowser = async (): Promise<SeekLoginResult> => {
  const response = await axios.post(`${API_URL}/apply/login/seek`);

  if (response.data && response.data.data) {
    return response.data.data as SeekLoginResult;
  }

  throw new Error('Invalid response format from Seek login API');
};

export const openJobSiteLoginBrowser = async (
  platform: LoginPlatform
): Promise<SeekLoginResult> => {
  const response = await axios.post(`${API_URL}/apply/login/${platform}`);

  if (response.data && response.data.data) {
    return response.data.data as SeekLoginResult;
  }

  throw new Error(`Invalid response format from ${platform} login API`);
};

export const fillApplicationProfileWithAi = async (
  resumes: Resume[],
  applicationProfile: ApplicationProfile,
  aiModel?: AiModel
): Promise<ApplicationProfileFillResult> => {
  const response = await axios.post(`${API_URL}/apply/profile/fill`, {
    resumes,
    applicationProfile,
    aiModel
  });

  if (response.data && response.data.data) {
    return response.data.data as ApplicationProfileFillResult;
  }

  throw new Error('Invalid response format from profile fill API');
};

const normalizeTrackedJobUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.toString();
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
};

export const fetchApplicationTrackingSummary = async (
  days: number = 14,
  recentLimit: number = 8
): Promise<ApplicationTrackingSummary> => {
  const response = await axios.get(`${API_URL}/applications/summary`, {
    params: {
      days,
      recentLimit
    }
  });

  if (response.data && response.data.data) {
    return response.data.data as ApplicationTrackingSummary;
  }

  throw new Error('Invalid response format from application summary API');
};

export const fetchApplicationHistory = async (limit: number = 20): Promise<TrackedJobApplication[]> => {
  const response = await axios.get(`${API_URL}/applications/history`, {
    params: { limit }
  });

  if (response.data && response.data.data) {
    return response.data.data as TrackedJobApplication[];
  }

  throw new Error('Invalid response format from application history API');
};

export const updateApplicationJobDetails = async (
  applicationId: string,
  jobDetails: JobDetails
): Promise<TrackedJobApplication> => {
  const response = await axios.patch(`${API_URL}/applications/${applicationId}/job-details`, {
    jobDetails
  });

  if (response.data && response.data.data) {
    return response.data.data as TrackedJobApplication;
  }

  throw new Error('Invalid response format from job details API');
};

export const updateTrackedApplicationProgressStage = async (
  applicationId: string,
  stage: ApplicationProgressStage
): Promise<TrackedJobApplication> => {
  const response = await axios.patch(`${API_URL}/applications/${applicationId}/progress`, {
    stage
  });

  if (response.data && response.data.data) {
    return response.data.data as TrackedJobApplication;
  }

  throw new Error('Invalid response format from application progress API');
};

export const enrichTrackedApplicationFromListing = async (
  applicationId: string
): Promise<TrackedJobApplication> => {
  const response = await axios.post(`${API_URL}/applications/${applicationId}/enrich`);

  if (response.data && response.data.data) {
    return response.data.data as TrackedJobApplication;
  }

  throw new Error('Invalid response format from application enrichment API');
};

export const fetchApplicationStatusesForJobs = async (
  jobUrls: string[]
): Promise<Map<string, TrackedJobApplication>> => {
  const uniqueJobUrls = Array.from(new Set(jobUrls.map(jobUrl => jobUrl.trim()).filter(Boolean)));

  if (uniqueJobUrls.length === 0) {
    return new Map();
  }

  const response = await axios.post(`${API_URL}/applications/statuses`, {
    jobUrls: uniqueJobUrls
  });

  if (!response.data || !Array.isArray(response.data.data)) {
    throw new Error('Invalid response format from application status API');
  }

  return new Map(
    (response.data.data as TrackedJobApplication[]).map(application => [
      normalizeTrackedJobUrl(application.jobUrl),
      application
    ])
  );
};

export { normalizeTrackedJobUrl };
