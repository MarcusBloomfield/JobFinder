import { JobDetails } from './JobDetails';

export type TrackedApplicationStatus = 'applying' | 'applied' | 'review_required' | 'failed' | 'skipped';
export type ApplicationTriggerSource = 'manual' | 'bulk';

export interface ApplicationArtifact {
  step: number;
  label: string;
  filePath: string;
  url: string;
}

export interface TrackedJobApplication {
  id: string;
  jobId: string;
  jobUrl: string;
  title: string;
  company: string;
  description: string;
  location?: string;
  salary?: string;
  datePosted?: string;
  matchScore?: number;
  jobDetails: JobDetails;
  resumeId: string;
  resumeFileName: string;
  coverLetterText?: string;
  coverLetterUsed: boolean;
  triggerSource: ApplicationTriggerSource;
  status: TrackedApplicationStatus;
  message: string;
  logs: string[];
  artifacts: ApplicationArtifact[];
  finalUrl?: string;
  steps: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ApplicationActivityPoint {
  day: string;
  totalCount: number;
  appliedCount: number;
  reviewRequiredCount: number;
  failedCount: number;
  skippedCount: number;
}

export interface ApplicationTrackingSummary {
  totalApplications: number;
  completedApplications: number;
  successfulApplications: number;
  successRate: number;
  statusCounts: Record<TrackedApplicationStatus, number>;
  recentActivity: ApplicationActivityPoint[];
  recentApplications: TrackedJobApplication[];
}
