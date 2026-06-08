import { JobDetails } from './JobDetails';

export type TrackedApplicationStatus = 'applying' | 'applied' | 'review_required' | 'failed' | 'skipped';
export type ApplicationTriggerSource = 'manual' | 'bulk';
export type ApplicationProgressStage = 'applied' | 'interviewed';

export interface ApplicationArtifact {
  step: number;
  label: string;
  filePath: string;
  url: string;
}

export interface TailoredResumeSnapshot {
  id: string;
  fileName: string;
  fileType: 'docx';
  content: string;
  filePath: string;
  url: string;
  sourceResumeId: string;
  sourceResumeFileName: string;
  matchKeywords: string[];
  tailoringNotes: string[];
  createdAt: string;
}

export interface CoverLetterDocumentSnapshot {
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
  resumeContent: string;
  resumeIsTailored: boolean;
  resumeSourceFileName?: string;
  tailoredResume?: TailoredResumeSnapshot;
  coverLetterText?: string;
  coverLetterUsed: boolean;
  coverLetterDocument?: CoverLetterDocumentSnapshot;
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
  interviewedCount: number;
  employedCount: number;
  reviewRequiredCount: number;
  failedCount: number;
  skippedCount: number;
}

export interface ApplicationTrackingSummary {
  totalApplications: number;
  completedApplications: number;
  successfulApplications: number;
  successRate: number;
  appliedCount: number;
  interviewedCount: number;
  employedCount: number;
  statusCounts: Record<TrackedApplicationStatus, number>;
  recentActivity: ApplicationActivityPoint[];
  activityCalendar: ApplicationActivityPoint[];
  activityYears: number[];
  recentApplications: TrackedJobApplication[];
}
