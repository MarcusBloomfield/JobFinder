import { ApplicationProfile } from '../../models/ApplicationProfile';
import { Job } from '../../models/Job';
import { Resume } from '../../models/Resume';
import { ApplicationPlatform } from '../applicationPlatformService';

export const APPLICATION_ADAPTER_STATUSES = [
  'running',
  'waiting_for_user',
  'ready_for_review',
  'submitted',
  'skipped',
  'failed'
] as const;

export type ApplicationAdapterStatus = (typeof APPLICATION_ADAPTER_STATUSES)[number];

export interface ApplicationAdapterArtifact {
  step: number;
  label: string;
  filePath: string;
  url: string;
}

export interface ApplicationAdapterResumeSnapshot {
  id: string;
  fileName: string;
  fileType: Resume['fileType'] | 'docx';
  content: string;
  filePath?: string;
  url?: string;
  sourceResumeId?: string;
  sourceResumeFileName?: string;
  matchKeywords?: string[];
  tailoringNotes?: string[];
  createdAt?: string;
}

export interface ApplicationAdapterCoverLetterSnapshot {
  id: string;
  fileName: string;
  fileType: 'docx';
  content: string;
  filePath: string;
  url: string;
  sourceResumeId: string;
  sourceResumeFileName: string;
  createdAt: string;
}

export interface ApplicationAdapterSnapshot {
  resumeId: string;
  resumeFileName: string;
  resumeContent: string;
  resumeIsTailored: boolean;
  resumeSourceFileName?: string;
  tailoredResume?: ApplicationAdapterResumeSnapshot;
  coverLetterText?: string;
  coverLetterUsed: boolean;
  coverLetterDocument?: ApplicationAdapterCoverLetterSnapshot;
}

export interface ApplicationContext {
  job: Job;
  resume: Resume;
  applicationProfile?: ApplicationProfile;
  applicationId?: string;
  applicationRunId?: string;
  platform: ApplicationPlatform;
  availableResumes?: Resume[];
  metadata?: Record<string, unknown>;
}

export interface ApplicationResult {
  status: ApplicationAdapterStatus;
  message: string;
  logs: string[];
  finalUrl: string;
  steps: number;
  artifacts: ApplicationAdapterArtifact[];
  applicationSnapshot?: ApplicationAdapterSnapshot;
  metadata?: Record<string, unknown>;
}

export interface ApplicationAdapter {
  id: string;
  displayName: string;
  platform: ApplicationPlatform;
  supportedPlatforms: ApplicationPlatform[];
  canAutoSubmit: boolean;
  apply(context: ApplicationContext): Promise<ApplicationResult>;
}
