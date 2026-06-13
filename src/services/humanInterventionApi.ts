import axios from 'axios';

const API_URL = 'http://localhost:5000/api';
const API_ORIGIN = 'http://localhost:5000';

export type HumanInterventionReason =
  | 'final_submission_approval'
  | 'captcha'
  | 'mfa'
  | 'missing_information'
  | 'unsupported_declaration'
  | 'manual_review'
  | 'unknown';

export type HumanInterventionStatus = 'pending' | 'continued' | 'skipped' | 'failed';
export type HumanInterventionAction = Exclude<HumanInterventionStatus, 'pending'>;

export interface HumanInterventionRecord {
  id: string;
  applicationId?: string;
  reason: HumanInterventionReason;
  title: string;
  message: string;
  pageUrl?: string;
  screenshotFilePath?: string;
  screenshotUrl?: string;
  artifacts?: HumanInterventionArtifact[];
  metadata?: Record<string, unknown>;
  status: HumanInterventionStatus;
  resolutionMessage?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface HumanInterventionArtifact {
  kind: string;
  step: number;
  label: string;
  filePath?: string;
  url?: string;
  createdAt?: string;
}

const getResponseData = <Data>(responseData: unknown): Data => {
  if (
    responseData &&
    typeof responseData === 'object' &&
    'data' in responseData
  ) {
    return (responseData as { data: Data }).data;
  }

  throw new Error('Invalid response format from intervention API');
};

export const fetchPendingHumanInterventions = async (): Promise<HumanInterventionRecord[]> => {
  const response = await axios.get(`${API_URL}/interventions/pending`);
  return getResponseData<HumanInterventionRecord[]>(response.data);
};

export const resolveHumanIntervention = async (
  interventionId: string,
  action: HumanInterventionAction
): Promise<HumanInterventionRecord> => {
  const pathByAction: Record<HumanInterventionAction, string> = {
    continued: 'continue',
    skipped: 'skip',
    failed: 'fail'
  };
  const response = await axios.post(
    `${API_URL}/interventions/${encodeURIComponent(interventionId)}/${pathByAction[action]}`
  );

  return getResponseData<HumanInterventionRecord>(response.data);
};

export const getHumanInterventionScreenshotUrl = (
  intervention: HumanInterventionRecord
): string | undefined => {
  if (intervention.screenshotUrl) {
    return intervention.screenshotUrl.startsWith('/')
      ? `${API_ORIGIN}${intervention.screenshotUrl}`
      : intervention.screenshotUrl;
  }

  if (intervention.screenshotFilePath) {
    return `${API_URL}/interventions/${encodeURIComponent(intervention.id)}/screenshot`;
  }

  return undefined;
};
