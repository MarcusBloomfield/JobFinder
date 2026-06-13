import { ApplicationProfile } from '../models/ApplicationProfile';
import { Job } from '../models/Job';
import { Resume } from '../models/Resume';
import { ApplicationResult } from './applicationAdapters/types';
import {
  getApplicationAdapterForPlatform
} from './applicationAdapters/adapterRegistry';
import { inferApplicationPlatform } from './applicationRunTrackingService';
import {
  ApplicationArtifact,
  ApplicationSnapshot,
  CoverLetterDocumentSnapshot,
  TailoredResumeSnapshot,
  buildApplicationSnapshot,
  openSeekLoginBrowser
} from './applicationAdapters/seekAdapter';

export type {
  ApplicationArtifact,
  ApplicationSnapshot,
  CoverLetterDocumentSnapshot,
  TailoredResumeSnapshot
};
export { buildApplicationSnapshot, openSeekLoginBrowser };

export interface JobApplicationResult {
  status: 'applied' | 'review_required' | 'failed' | 'skipped';
  message: string;
  logs: string[];
  finalUrl: string;
  steps: number;
  artifacts: ApplicationArtifact[];
  applicationSnapshot: ApplicationSnapshot;
}

const mapAdapterResultStatus = (
  status: ApplicationResult['status']
): JobApplicationResult['status'] => {
  switch (status) {
    case 'submitted':
      return 'applied';
    case 'waiting_for_user':
    case 'ready_for_review':
      return 'review_required';
    case 'skipped':
      return 'skipped';
    case 'running':
    case 'failed':
    default:
      return 'failed';
  }
};

const mapAdapterResult = (
  job: Job,
  resume: Resume,
  result: ApplicationResult
): JobApplicationResult => {
  const applicationSnapshot = result.applicationSnapshot as ApplicationSnapshot | undefined;

  return {
    status: mapAdapterResultStatus(result.status),
    message: result.message,
    logs: result.logs,
    finalUrl: result.finalUrl,
    steps: result.steps,
    artifacts: result.artifacts,
    applicationSnapshot: applicationSnapshot || buildApplicationSnapshot(job, resume)
  };
};

export const applyToJob = async (
  job: Job,
  resume: Resume,
  applicationProfile?: ApplicationProfile,
  applicationId?: string,
  applicationRunId?: string
): Promise<JobApplicationResult> => {
  const platform = inferApplicationPlatform(job.url);
  const adapter = getApplicationAdapterForPlatform(platform);
  const result = await adapter.apply({
    job,
    resume,
    applicationProfile,
    applicationId,
    applicationRunId,
    platform
  });

  return mapAdapterResult(job, resume, result);
};
