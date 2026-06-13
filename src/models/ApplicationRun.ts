export type ApplicationRunStatus =
  | 'running'
  | 'waiting_for_user'
  | 'ready_for_review'
  | 'submitted'
  | 'skipped'
  | 'failed';

export type ApplicationRunInterventionStatus = 'pending' | 'continued' | 'skipped' | 'failed';

export interface ApplicationRunIntervention {
  id: string;
  status: ApplicationRunInterventionStatus;
  reason: string;
  title: string;
  message: string;
  pageUrl?: string;
  screenshotUrl?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface ApplicationRunDiagnostics {
  errorMessage?: string;
  errorStack?: string;
  metadata?: Record<string, unknown>;
}

export interface ApplicationRunAsset {
  filePath?: string;
  url?: string;
}

export interface ApplicationRunRecord {
  id: string;
  applicationId: string;
  status: ApplicationRunStatus;
  platform: string;
  currentStep: number;
  currentUrl?: string;
  errorMessage?: string;
  errorStack?: string;
  screenshotFilePath?: string;
  screenshotUrl?: string;
  snapshotFilePath?: string;
  snapshotUrl?: string;
  metadata?: Record<string, unknown>;
  diagnostics: ApplicationRunDiagnostics;
  screenshots: ApplicationRunAsset;
  snapshot: ApplicationRunAsset;
  intervention?: ApplicationRunIntervention;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
