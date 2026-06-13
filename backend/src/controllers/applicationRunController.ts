import { Request, Response } from 'express';
import {
  ApplicationRunRecord,
  ApplicationRunStatus,
  getApplicationRunById,
  listApplicationRuns,
  markApplicationRunSkipped
} from '../services/applicationRunTrackingService';
import {
  HumanInterventionRecord,
  listHumanInterventionsForApplication
} from '../services/humanInterventionService';

const RUN_STATUSES: ApplicationRunStatus[] = [
  'running',
  'waiting_for_user',
  'ready_for_review',
  'submitted',
  'skipped',
  'failed'
];

interface ApplicationRunApiRecord extends ApplicationRunRecord {
  artifacts: ApplicationRunArtifact[];
  diagnostics: {
    errorMessage?: string;
    errorStack?: string;
    metadata?: Record<string, unknown>;
    artifacts: ApplicationRunArtifact[];
  };
  screenshots: {
    filePath?: string;
    url?: string;
  };
  snapshot: {
    filePath?: string;
    url?: string;
  };
  intervention?: Pick<
    HumanInterventionRecord,
    'id' | 'status' | 'reason' | 'title' | 'message' | 'pageUrl' | 'screenshotUrl' | 'createdAt' | 'updatedAt' | 'resolvedAt'
  >;
}

interface ApplicationRunArtifact {
  kind: string;
  step: number;
  label: string;
  filePath?: string;
  url?: string;
  createdAt?: string;
}

const parseLimit = (value: unknown): number => {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed)
    ? Math.max(1, Math.min(200, Math.floor(parsed)))
    : 50;
};

const normalizeText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const getRunId = (req: Request): string | undefined => normalizeText(req.params.id);

const getLatestIntervention = (applicationId: string): HumanInterventionRecord | undefined =>
  listHumanInterventionsForApplication(applicationId)[0];

const getRunArtifacts = (metadata: Record<string, unknown> | undefined): ApplicationRunArtifact[] => {
  const value = metadata?.artifactUrls;
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const artifact = item as Record<string, unknown>;
      return {
        kind: typeof artifact.kind === 'string' ? artifact.kind : 'artifact',
        step: typeof artifact.step === 'number' ? artifact.step : 0,
        label: typeof artifact.label === 'string' ? artifact.label : 'Artifact',
        filePath: typeof artifact.filePath === 'string' ? artifact.filePath : undefined,
        url: typeof artifact.url === 'string' ? artifact.url : undefined,
        createdAt: typeof artifact.createdAt === 'string' ? artifact.createdAt : undefined
      };
    });
};

const toApplicationRunApiRecord = (run: ApplicationRunRecord): ApplicationRunApiRecord => {
  const intervention = getLatestIntervention(run.applicationId);
  const artifacts = getRunArtifacts(run.metadata);

  return {
    ...run,
    artifacts,
    diagnostics: {
      errorMessage: run.errorMessage,
      errorStack: run.errorStack,
      metadata: run.metadata,
      artifacts
    },
    screenshots: {
      filePath: run.screenshotFilePath,
      url: run.screenshotUrl
    },
    snapshot: {
      filePath: run.snapshotFilePath,
      url: run.snapshotUrl
    },
    intervention: intervention
      ? {
          id: intervention.id,
          status: intervention.status,
          reason: intervention.reason,
          title: intervention.title,
          message: intervention.message,
          pageUrl: intervention.pageUrl,
          screenshotUrl: intervention.screenshotUrl,
          createdAt: intervention.createdAt,
          updatedAt: intervention.updatedAt,
          resolvedAt: intervention.resolvedAt
        }
      : undefined
  };
};

const sendMissingRun = (res: Response) =>
  res.status(404).json({
    error: true,
    message: 'Application run not found.'
  });

export const getApplicationRuns = (req: Request, res: Response) => {
  try {
    const status = normalizeText(req.query.status);
    if (status && !RUN_STATUSES.includes(status as ApplicationRunStatus)) {
      return res.status(400).json({
        error: true,
        message: 'Invalid run status.'
      });
    }

    const runs = listApplicationRuns({
      applicationId: normalizeText(req.query.applicationId),
      status: status as ApplicationRunStatus | undefined,
      limit: parseLimit(req.query.limit)
    }).map(toApplicationRunApiRecord);

    return res.status(200).json({
      error: false,
      data: runs
    });
  } catch (error) {
    console.error('Error in getApplicationRuns controller:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};

export const getApplicationRun = (req: Request, res: Response) => {
  try {
    const runId = getRunId(req);
    if (!runId) {
      return res.status(400).json({
        error: true,
        message: 'Missing application run id.'
      });
    }

    const run = getApplicationRunById(runId);
    if (!run) {
      return sendMissingRun(res);
    }

    return res.status(200).json({
      error: false,
      data: toApplicationRunApiRecord(run)
    });
  } catch (error) {
    console.error('Error in getApplicationRun controller:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};

export const cancelApplicationRun = (req: Request, res: Response) => {
  try {
    const runId = getRunId(req);
    if (!runId) {
      return res.status(400).json({
        error: true,
        message: 'Missing application run id.'
      });
    }

    const run = getApplicationRunById(runId);
    if (!run) {
      return sendMissingRun(res);
    }

    if (run.completedAt) {
      return res.status(409).json({
        error: true,
        message: 'Application run is already complete.'
      });
    }

    const cancelled = markApplicationRunSkipped(runId, {
      errorMessage: 'Cancelled by user.',
      metadata: {
        ...(run.metadata || {}),
        cancelledAt: new Date().toISOString()
      }
    });

    if (!cancelled) {
      return sendMissingRun(res);
    }

    return res.status(200).json({
      error: false,
      data: toApplicationRunApiRecord(cancelled)
    });
  } catch (error) {
    console.error('Error in cancelApplicationRun controller:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};
