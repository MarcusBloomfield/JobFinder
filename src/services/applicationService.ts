import axios from 'axios';
import { Job } from '../models/Job';
import { Resume } from '../models/Resume';
import { ApplicationProfile } from '../models/ApplicationProfile';

const API_URL = 'http://localhost:5000/api';

export interface JobApplicationResult {
  status: 'applied' | 'review_required' | 'failed' | 'skipped';
  message: string;
  logs: string[];
  finalUrl: string;
  steps: number;
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

export const applyToJob = async (
  job: Job,
  resume: Resume,
  applicationProfile: ApplicationProfile
): Promise<JobApplicationResult> => {
  const response = await axios.post(`${API_URL}/apply/job`, { job, resume, applicationProfile });

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
