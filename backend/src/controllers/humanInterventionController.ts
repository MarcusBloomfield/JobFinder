import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';
import {
  HumanInterventionRecord,
  HumanInterventionResolutionAction,
  getHumanInterventionById,
  getHumanInterventionScreenshot,
  listPendingHumanInterventions,
  resolveHumanIntervention
} from '../services/humanInterventionService';

const RESOLUTION_ACTIONS: HumanInterventionResolutionAction[] = ['continued', 'skipped', 'failed'];

interface HumanInterventionArtifact {
  kind: string;
  step: number;
  label: string;
  filePath?: string;
  url?: string;
  createdAt?: string;
}

interface HumanInterventionApiRecord extends HumanInterventionRecord {
  artifacts: HumanInterventionArtifact[];
}

const getInterventionArtifacts = (
  metadata: Record<string, unknown> | undefined
): HumanInterventionArtifact[] => {
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

const toHumanInterventionApiRecord = (
  intervention: HumanInterventionRecord
): HumanInterventionApiRecord => ({
  ...intervention,
  artifacts: getInterventionArtifacts(intervention.metadata)
});

const getInterventionId = (req: Request): string | undefined => {
  const { id } = req.params as { id?: string };
  return typeof id === 'string' && id.trim() ? id.trim() : undefined;
};

const getResolutionMessage = (req: Request): string | undefined => {
  const { message, note, response, approvedAnswers } = req.body as {
    message?: unknown;
    note?: unknown;
    response?: unknown;
    approvedAnswers?: unknown;
  };
  const candidate = message ?? note ?? response;
  const resolutionMessage =
    typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;

  if (Array.isArray(approvedAnswers)) {
    return JSON.stringify({
      message: resolutionMessage,
      approvedAnswers
    });
  }

  return resolutionMessage;
};

const sendMissingIntervention = (res: Response) =>
  res.status(404).json({
    error: true,
    message: 'Intervention not found.'
  });

const sendResolvedIntervention = (res: Response) =>
  res.status(409).json({
    error: true,
    message: 'Intervention already resolved.'
  });

const resolvePendingIntervention = (
  req: Request,
  res: Response,
  action: HumanInterventionResolutionAction
) => {
  const interventionId = getInterventionId(req);
  if (!interventionId) {
    return res.status(400).json({
      error: true,
      message: 'Missing intervention id.'
    });
  }

  const intervention = getHumanInterventionById(interventionId);
  if (!intervention) {
    return sendMissingIntervention(res);
  }

  if (intervention.status !== 'pending') {
    return sendResolvedIntervention(res);
  }

  if (!RESOLUTION_ACTIONS.includes(action)) {
    return res.status(400).json({
      error: true,
      message: 'Invalid intervention action.'
    });
  }

  const data = resolveHumanIntervention(interventionId, action, getResolutionMessage(req));
  if (!data) {
    return sendResolvedIntervention(res);
  }

  return res.status(200).json({
    error: false,
    data: toHumanInterventionApiRecord(data)
  });
};

export const getPendingInterventions = (_req: Request, res: Response) => {
  try {
    res.status(200).json({
      error: false,
      data: listPendingHumanInterventions().map(toHumanInterventionApiRecord)
    });
  } catch (error) {
    console.error('Error in getPendingInterventions controller:', error);
    res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};

export const getIntervention = (req: Request, res: Response) => {
  try {
    const interventionId = getInterventionId(req);
    if (!interventionId) {
      return res.status(400).json({
        error: true,
        message: 'Missing intervention id.'
      });
    }

    const data = getHumanInterventionById(interventionId);
    if (!data) {
      return sendMissingIntervention(res);
    }

    return res.status(200).json({
      error: false,
      data: toHumanInterventionApiRecord(data)
    });
  } catch (error) {
    console.error('Error in getIntervention controller:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};

export const continueIntervention = (req: Request, res: Response) => {
  try {
    return resolvePendingIntervention(req, res, 'continued');
  } catch (error) {
    console.error('Error in continueIntervention controller:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};

export const skipIntervention = (req: Request, res: Response) => {
  try {
    return resolvePendingIntervention(req, res, 'skipped');
  } catch (error) {
    console.error('Error in skipIntervention controller:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};

export const failIntervention = (req: Request, res: Response) => {
  try {
    return resolvePendingIntervention(req, res, 'failed');
  } catch (error) {
    console.error('Error in failIntervention controller:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};

export const getInterventionScreenshot = (req: Request, res: Response) => {
  try {
    const interventionId = getInterventionId(req);
    if (!interventionId) {
      return res.status(400).json({
        error: true,
        message: 'Missing intervention id.'
      });
    }

    const intervention = getHumanInterventionById(interventionId);
    if (!intervention) {
      return sendMissingIntervention(res);
    }

    const screenshot = getHumanInterventionScreenshot(interventionId);
    const screenshotPath = screenshot?.filePath ? path.resolve(screenshot.filePath) : undefined;
    if (!screenshotPath || !fs.existsSync(screenshotPath)) {
      return res.status(404).json({
        error: true,
        message: 'Screenshot not found.'
      });
    }

    return res.sendFile(screenshotPath);
  } catch (error) {
    console.error('Error in getInterventionScreenshot controller:', error);
    return res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};
