import axios from 'axios';
import {
  ApplicationRunRecord,
  ApplicationRunStatus
} from '../models/ApplicationRun';

const API_URL = 'http://localhost:5000/api';
const API_ORIGIN = 'http://localhost:5000';

export interface FetchApplicationRunsOptions {
  applicationId?: string;
  status?: ApplicationRunStatus;
  limit?: number;
}

const getResponseData = <Data>(responseData: unknown): Data => {
  if (
    responseData &&
    typeof responseData === 'object' &&
    'data' in responseData
  ) {
    return (responseData as { data: Data }).data;
  }

  throw new Error('Invalid response format from application run API');
};

const normalizeAssetUrl = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }

  return value.startsWith('/') ? `${API_ORIGIN}${value}` : value;
};

export const fetchApplicationRuns = async (
  options: FetchApplicationRunsOptions = {}
): Promise<ApplicationRunRecord[]> => {
  const response = await axios.get(`${API_URL}/application-runs`, {
    params: options
  });

  return getResponseData<ApplicationRunRecord[]>(response.data);
};

export const fetchApplicationRun = async (runId: string): Promise<ApplicationRunRecord> => {
  const response = await axios.get(`${API_URL}/application-runs/${encodeURIComponent(runId)}`);
  return getResponseData<ApplicationRunRecord>(response.data);
};

export const cancelApplicationRun = async (runId: string): Promise<ApplicationRunRecord> => {
  const response = await axios.post(
    `${API_URL}/application-runs/${encodeURIComponent(runId)}/cancel`
  );

  return getResponseData<ApplicationRunRecord>(response.data);
};

export const getApplicationRunScreenshotUrl = (
  run: ApplicationRunRecord
): string | undefined =>
  normalizeAssetUrl(run.screenshots?.url || run.screenshotUrl);

export const getApplicationRunSnapshotUrl = (
  run: ApplicationRunRecord
): string | undefined =>
  normalizeAssetUrl(run.snapshot?.url || run.snapshotUrl);
