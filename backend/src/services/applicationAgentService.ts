import { ApplicationProfile } from '../models/ApplicationProfile';
import { Job } from '../models/Job';
import { Resume } from '../models/Resume';
import {
  ApplicationResult,
  ApplicationAdapterStatus
} from './applicationAdapters/types';
import {
  getApplicationAdapterForPlatform,
  isKnownApplicationPlatform
} from './applicationAdapters/adapterRegistry';
import { detectPlatform, ApplicationPlatform } from './applicationPlatformService';
import {
  createApplicationRun,
  markApplicationRunFailed,
  markApplicationRunReadyForReview,
  markApplicationRunSkipped,
  markApplicationRunSubmitted,
  markApplicationRunWaitingForUser
} from './applicationRunTrackingService';
import {
  ApplicationTriggerSource,
  createTrackedApplication,
  failTrackedApplication,
  finalizeTrackedApplication
} from './applicationTrackingService';
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

export type OrchestratedApplicationStatus =
  | 'applied'
  | 'ready_for_review'
  | 'needs_human'
  | 'skipped'
  | 'failed';

export interface JobApplicationResult {
  status: 'applied' | 'review_required' | 'failed' | 'skipped';
  orchestrationStatus?: OrchestratedApplicationStatus;
  adapterStatus?: ApplicationAdapterStatus;
  trackingId?: string;
  runId?: string;
  platform?: ApplicationPlatform;
  adapterId?: string;
  message: string;
  logs: string[];
  finalUrl: string;
  steps: number;
  artifacts: ApplicationArtifact[];
  applicationSnapshot: ApplicationSnapshot;
}

const isEnabled = (value?: string): boolean => {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const getAllowedPlatforms = (): Set<ApplicationPlatform> | null => {
  const configured = process.env.APPLY_AGENT_ALLOWED_PLATFORMS?.trim();
  if (!configured) {
    return null;
  }

  const platforms = configured
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);

  if (platforms.includes('*') || platforms.includes('all')) {
    return null;
  }

  return new Set(
    platforms.filter(isKnownApplicationPlatform)
  );
};

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

const mapOrchestrationStatus = (
  status: ApplicationResult['status']
): OrchestratedApplicationStatus => {
  switch (status) {
    case 'submitted':
      return 'applied';
    case 'waiting_for_user':
      return 'needs_human';
    case 'ready_for_review':
      return 'ready_for_review';
    case 'skipped':
      return 'skipped';
    case 'running':
    case 'failed':
    default:
      return 'failed';
  }
};

const latestArtifact = (result: ApplicationResult): ApplicationArtifact | undefined =>
  result.artifacts[result.artifacts.length - 1] as ApplicationArtifact | undefined;

const mapAdapterResult = (
  job: Job,
  resume: Resume,
  result: ApplicationResult,
  metadata: {
    trackingId?: string;
    runId?: string;
    platform?: ApplicationPlatform;
    adapterId?: string;
  } = {}
): JobApplicationResult => {
  const applicationSnapshot = result.applicationSnapshot as ApplicationSnapshot | undefined;

  return {
    status: mapAdapterResultStatus(result.status),
    orchestrationStatus: mapOrchestrationStatus(result.status),
    adapterStatus: result.status,
    trackingId: metadata.trackingId,
    runId: metadata.runId,
    platform: metadata.platform,
    adapterId: metadata.adapterId,
    message: result.message,
    logs: result.logs,
    finalUrl: result.finalUrl,
    steps: result.steps,
    artifacts: result.artifacts as ApplicationArtifact[],
    applicationSnapshot: applicationSnapshot || buildApplicationSnapshot(job, resume)
  };
};

const markRunFromAdapterResult = (runId: string, result: ApplicationResult): void => {
  const artifact = latestArtifact(result);
  const updates = {
    currentStep: result.steps,
    currentUrl: result.finalUrl,
    errorMessage:
      result.status === 'failed' || result.status === 'skipped' ? result.message : undefined,
    screenshotFilePath: artifact?.filePath,
    screenshotUrl: artifact?.url
  };

  switch (result.status) {
    case 'submitted':
      markApplicationRunSubmitted(runId, updates);
      break;
    case 'waiting_for_user':
      markApplicationRunWaitingForUser(runId, {
        ...updates,
        errorMessage: result.message
      });
      break;
    case 'ready_for_review':
      markApplicationRunReadyForReview(runId, {
        ...updates,
        errorMessage: result.message
      });
      break;
    case 'skipped':
      markApplicationRunSkipped(runId, updates);
      break;
    case 'failed':
    case 'running':
    default:
      markApplicationRunFailed(runId, {
        ...updates,
        errorMessage: result.message
      });
      break;
  }
};

const buildSkippedAdapterResult = (
  job: Job,
  resume: Resume,
  message: string,
  logs: string[]
): ApplicationResult => ({
  status: 'skipped',
  message,
  logs,
  finalUrl: job.url,
  steps: 0,
  artifacts: [],
  applicationSnapshot: buildApplicationSnapshot(job, resume)
});

export const applyToJob = async (
  job: Job,
  resume: Resume,
  applicationProfile?: ApplicationProfile,
  triggerSource: ApplicationTriggerSource = 'manual'
): Promise<JobApplicationResult> => {
  const platform = detectPlatform(job.url);
  const adapter = getApplicationAdapterForPlatform(platform);
  const requireFinalReview =
    process.env.APPLY_AGENT_REQUIRE_FINAL_REVIEW === undefined
      ? true
      : isEnabled(process.env.APPLY_AGENT_REQUIRE_FINAL_REVIEW);
  const allowedPlatforms = getAllowedPlatforms();
  const trackedApplication = createTrackedApplication(
    job,
    resume,
    applicationProfile,
    triggerSource
  );
  const applicationRun = createApplicationRun({
    applicationId: trackedApplication.id,
    platform,
    currentUrl: job.url,
    metadata: {
      triggerSource,
      jobId: job.id,
      jobTitle: job.title,
      company: job.company,
      adapter: adapter.id,
      adapterName: adapter.displayName,
      requireFinalReview,
      allowedPlatforms: allowedPlatforms ? Array.from(allowedPlatforms) : 'all'
    }
  });

  try {
    const result =
      allowedPlatforms && !allowedPlatforms.has(platform)
        ? buildSkippedAdapterResult(
            job,
            resume,
            `Skipped auto-apply because platform "${platform}" is not in APPLY_AGENT_ALLOWED_PLATFORMS.`,
            [
              `Detected platform: ${platform}.`,
              `Selected adapter: ${adapter.id}.`,
              'Application was skipped before browser automation.'
            ]
          )
        : await adapter.apply({
            job,
            resume,
            applicationProfile,
            applicationId: trackedApplication.id,
            applicationRunId: applicationRun.id,
            platform,
            requireFinalReview,
            metadata: {
              triggerSource,
              requireFinalReview
            }
          });

    markRunFromAdapterResult(applicationRun.id, result);
    const mappedResult = mapAdapterResult(job, resume, result, {
      trackingId: trackedApplication.id,
      runId: applicationRun.id,
      platform,
      adapterId: adapter.id
    });
    finalizeTrackedApplication(trackedApplication.id, mappedResult);
    return mappedResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred';
    failTrackedApplication(trackedApplication.id, message);
    markApplicationRunFailed(applicationRun.id, {
      errorMessage: message,
      errorStack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
};
