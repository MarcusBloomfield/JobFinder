import fs from 'fs';
import path from 'path';
import { BrowserContext, Page, chromium } from 'playwright';
import { ApplicationProfile } from '../models/ApplicationProfile';
import { AiModel } from '../models/AiSettings';
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
  getApplicationRunById,
  markApplicationRunFailed,
  markApplicationRunReadyForReview,
  markApplicationRunSkipped,
  markApplicationRunSubmitted,
  markApplicationRunWaitingForUser,
  updateApplicationRun
} from './applicationRunTrackingService';
import {
  ApplicationTriggerSource,
  createTrackedApplication,
  failTrackedApplication,
  finalizeTrackedApplication,
  markTrackedApplicationSkipped
} from './applicationTrackingService';
import {
  beginApplicationRunCancellationScope,
  endApplicationRunCancellationScope,
  isApplicationRunCancellationError,
  isApplicationRunCancellationRequested
} from './applicationRunCancellationService';
import {
  ApplicationArtifact,
  ApplicationSnapshot,
  CoverLetterDocumentSnapshot,
  TailoredResumeSnapshot,
  buildApplicationSnapshot,
  closeSeekLoginSessionIfOpen,
  openSeekLoginBrowser
} from './applicationAdapters/seekAdapter';

export type {
  ApplicationArtifact,
  ApplicationSnapshot,
  CoverLetterDocumentSnapshot,
  TailoredResumeSnapshot
};
export { buildApplicationSnapshot, openSeekLoginBrowser };

export type LoginPlatform = 'seek' | 'linkedin' | 'employmenthero';

interface LoginBrowserConfig {
  platform: LoginPlatform;
  displayName: string;
  loginUrl: string;
  profileDirName: string;
}

const PLAYWRIGHT_DIR = path.resolve(__dirname, '../../.playwright');

const loginBrowserConfigs: Record<Exclude<LoginPlatform, 'seek'>, LoginBrowserConfig> = {
  linkedin: {
    platform: 'linkedin',
    displayName: 'LinkedIn',
    loginUrl: 'https://www.linkedin.com/login',
    profileDirName: 'linkedin-profile'
  },
  employmenthero: {
    platform: 'employmenthero',
    displayName: 'Employment Hero',
    loginUrl: 'https://employmenthero.com/jobs/',
    profileDirName: 'employmenthero-profile'
  }
};

const loginSessions = new Map<LoginPlatform, { context: BrowserContext; page: Page }>();

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

export const mapAdapterResultStatus = (
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

export const mapOrchestrationStatus = (
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
  if (isApplicationRunCancellationRequested(runId)) {
    return;
  }

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

const getStringMetadata = (
  metadata: Record<string, unknown> | undefined,
  key: string
): string | undefined => {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

export const getGenericHandoffUrl = (result: ApplicationResult): string | undefined => {
  if (result.metadata?.handoffToGenericAdapter !== true) {
    return undefined;
  }

  const handoffUrl = getStringMetadata(result.metadata, 'handoffUrl') || result.finalUrl;
  try {
    const parsed = new URL(handoffUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

export const isGenericHandoffAllowed = (
  allowedPlatforms: Set<ApplicationPlatform> | null,
  targetPlatform: ApplicationPlatform
): boolean =>
  !allowedPlatforms || allowedPlatforms.has('generic') || allowedPlatforms.has(targetPlatform);

export const getResultPlatform = (
  result: ApplicationResult,
  fallback: ApplicationPlatform
): ApplicationPlatform => {
  const platform = result.metadata?.platform;
  if (typeof platform === 'string' && isKnownApplicationPlatform(platform)) {
    return platform;
  }

  const handoffPlatform = result.metadata?.handoffPlatform;
  return typeof handoffPlatform === 'string' && isKnownApplicationPlatform(handoffPlatform)
    ? handoffPlatform
    : fallback;
};

const getBrowserChannel = (): 'chrome' | 'msedge' | undefined => {
  const configured = process.env.PLAYWRIGHT_BROWSER_CHANNEL?.toLowerCase();

  if (configured === 'chrome' || configured === 'msedge') {
    return configured;
  }

  return process.platform === 'win32' ? 'chrome' : undefined;
};

const getSlowMo = (): number => {
  const configured = Number(process.env.PLAYWRIGHT_SLOWMO_MS);
  if (Number.isFinite(configured) && configured >= 0) {
    return Math.max(150, configured);
  }

  return 150;
};

const getLoginProfileDir = (profileDirName: string): string => {
  const configured = process.env.PLAYWRIGHT_USER_DATA_DIR?.trim();
  if (configured && profileDirName === 'seek-profile') {
    return configured;
  }

  return path.join(PLAYWRIGHT_DIR, profileDirName);
};

const closeLoginSessionIfOpen = async (platform: LoginPlatform): Promise<void> => {
  const session = loginSessions.get(platform);
  if (!session) {
    return;
  }

  try {
    await session.context.close();
  } catch {
    // Ignore cleanup failures for already-closed browser windows.
  } finally {
    loginSessions.delete(platform);
  }
};

const openSharedLoginBrowser = async (
  config: LoginBrowserConfig
): Promise<{ message: string; profileDir: string; url: string }> => {
  const existingSession = loginSessions.get(config.platform);
  const profileDir = getLoginProfileDir(config.profileDirName);

  if (existingSession) {
    try {
      await existingSession.page.goto(config.loginUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      await existingSession.page.bringToFront();
      return {
        message: `${config.displayName} login browser is already open. Log in there once, then future auto-apply runs will reuse this profile.`,
        profileDir,
        url: existingSession.page.url()
      };
    } catch {
      await closeLoginSessionIfOpen(config.platform);
    }
  }

  fs.mkdirSync(profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: getBrowserChannel(),
    headless: false,
    slowMo: getSlowMo(),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    viewport: { width: 1440, height: 960 }
  });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.bringToFront();

  context.on('close', () => {
    const session = loginSessions.get(config.platform);
    if (session?.context === context) {
      loginSessions.delete(config.platform);
    }
  });

  loginSessions.set(config.platform, { context, page });

  return {
    message: `Opened a Playwright-controlled ${config.displayName} login window. Log in once there and later auto-apply runs will reuse the same Chrome profile.`,
    profileDir,
    url: page.url()
  };
};

export const openJobSiteLoginBrowser = async (
  platform: LoginPlatform
): Promise<{ message: string; profileDir: string; url: string }> => {
  if (platform === 'seek') {
    return openSeekLoginBrowser();
  }

  return openSharedLoginBrowser(loginBrowserConfigs[platform]);
};

export const closeJobSiteLoginBrowserSession = async (platform: LoginPlatform): Promise<void> => {
  if (platform === 'seek') {
    await closeSeekLoginSessionIfOpen();
    return;
  }

  await closeLoginSessionIfOpen(platform);
};

export const applyToJob = async (
  job: Job,
  resume: Resume,
  applicationProfile?: ApplicationProfile,
  triggerSource: ApplicationTriggerSource = 'manual',
  aiModel?: AiModel
): Promise<JobApplicationResult> => {
  const platform = detectPlatform(job.url);
  const adapter = getApplicationAdapterForPlatform(platform);
  const requireFinalReview =
    process.env.APPLY_AGENT_REQUIRE_FINAL_REVIEW === undefined
      ? false
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
      allowedPlatforms: allowedPlatforms ? Array.from(allowedPlatforms) : 'all',
      aiModel
    }
  });
  const cancellation = beginApplicationRunCancellationScope(applicationRun.id);

  try {
    cancellation.throwIfCancellationRequested();
    let result: ApplicationResult;
    if (allowedPlatforms && !allowedPlatforms.has(platform)) {
      result = buildSkippedAdapterResult(
        job,
        resume,
        `Skipped auto-apply because platform "${platform}" is not in APPLY_AGENT_ALLOWED_PLATFORMS.`,
        [
          `Detected platform: ${platform}.`,
          `Selected adapter: ${adapter.id}.`,
          'Application was skipped before browser automation.'
        ]
      );
    } else {
      if (platform === 'linkedin' || platform === 'employmenthero') {
        await closeLoginSessionIfOpen(platform);
      }

      result = await adapter.apply({
        job,
        resume,
        applicationProfile,
        applicationId: trackedApplication.id,
        applicationRunId: applicationRun.id,
        cancellation,
        platform,
        requireFinalReview,
        metadata: {
          triggerSource,
          requireFinalReview,
          aiModel
        }
      });

      const handoffUrl = getGenericHandoffUrl(result);
      if (handoffUrl) {
        const handoffPlatform = detectPlatform(handoffUrl);
        const genericAdapter = getApplicationAdapterForPlatform('generic');
        const handoffSourceAdapter =
          getStringMetadata(result.metadata, 'handoffSourceAdapter') || adapter.id;

        if (!isGenericHandoffAllowed(allowedPlatforms, handoffPlatform)) {
          result = {
            ...result,
            status: 'skipped',
            message: `Skipped external application website because platform "${handoffPlatform}" is not allowed by APPLY_AGENT_ALLOWED_PLATFORMS.`,
            finalUrl: handoffUrl,
            logs: [
              ...result.logs,
              `External handoff URL: ${handoffUrl}.`,
              `Detected handoff platform: ${handoffPlatform}.`,
              'Generic adapter handoff was skipped before browser automation.'
            ],
            metadata: {
              ...(result.metadata || {}),
              handoffBlocked: true,
              handoffPlatform,
              handoffUrl
            }
          };
        } else {
          const existingRunMetadata = getApplicationRunById(applicationRun.id)?.metadata || {};
          updateApplicationRun(applicationRun.id, {
            status: 'running',
            platform: handoffPlatform,
            currentUrl: handoffUrl,
            errorMessage: '',
            errorStack: '',
            metadata: {
              ...existingRunMetadata,
              adapter: genericAdapter.id,
              adapterName: genericAdapter.displayName,
              handoffFromAdapter: handoffSourceAdapter,
              handoffUrl,
              originalJobUrl: job.url,
              triggerSource,
              requireFinalReview,
              aiModel
            }
          });

          const genericResult = await genericAdapter.apply({
            job: {
              ...job,
              url: handoffUrl
            },
            resume,
            applicationProfile,
            applicationId: trackedApplication.id,
            applicationRunId: applicationRun.id,
            cancellation,
            platform: handoffPlatform,
            requireFinalReview,
            metadata: {
              triggerSource,
              requireFinalReview,
              aiModel,
              originalJobUrl: job.url,
              handoffFromAdapter: handoffSourceAdapter,
              handoffUrl
            }
          });

          result = {
            ...genericResult,
            logs: [
              ...result.logs,
              `Handed off from ${handoffSourceAdapter} adapter to generic adapter at ${handoffUrl}.`,
              ...genericResult.logs
            ],
            steps: result.steps + genericResult.steps,
            artifacts: [...result.artifacts, ...genericResult.artifacts],
            metadata: {
              ...(genericResult.metadata || {}),
              handoffFromAdapter: handoffSourceAdapter,
              handoffUrl,
              originalJobUrl: job.url
            }
          };
        }
      }
    }

    if (isApplicationRunCancellationRequested(applicationRun.id)) {
      result = buildSkippedAdapterResult(job, resume, 'Cancelled by user.', [
        ...result.logs,
        'Application run was cancelled by the user.'
      ]);
    }

    markRunFromAdapterResult(applicationRun.id, result);
    const resultPlatform = getResultPlatform(result, platform);
    const mappedResult = mapAdapterResult(job, resume, result, {
      trackingId: trackedApplication.id,
      runId: applicationRun.id,
      platform: resultPlatform,
      adapterId: getStringMetadata(result.metadata, 'adapterId') || adapter.id
    });
    if (isApplicationRunCancellationRequested(applicationRun.id)) {
      markTrackedApplicationSkipped(trackedApplication.id, 'Cancelled by user.');
    } else {
      finalizeTrackedApplication(trackedApplication.id, mappedResult);
    }
    return mappedResult;
  } catch (error) {
    if (
      isApplicationRunCancellationError(error) ||
      isApplicationRunCancellationRequested(applicationRun.id)
    ) {
      markTrackedApplicationSkipped(trackedApplication.id, 'Cancelled by user.');
      const cancelledResult = buildSkippedAdapterResult(job, resume, 'Cancelled by user.', [
        'Application run was cancelled by the user.'
      ]);
      return mapAdapterResult(job, resume, cancelledResult, {
        trackingId: trackedApplication.id,
        runId: applicationRun.id,
        platform,
        adapterId: adapter.id
      });
    }

    const message = error instanceof Error ? error.message : 'An unknown error occurred';
    failTrackedApplication(trackedApplication.id, message);
    markApplicationRunFailed(applicationRun.id, {
      errorMessage: message,
      errorStack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  } finally {
    endApplicationRunCancellationScope(applicationRun.id);
  }
};
