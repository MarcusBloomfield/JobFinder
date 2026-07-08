import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  ApplicationArtifact,
  ApplicationSnapshot,
  CoverLetterDocumentSnapshot,
  TailoredResumeSnapshot,
  buildApplicationSnapshot
} from './applicationAdapters/seekAdapter';
import type { JobApplicationResult } from './applicationAgentService';
import { ApplicationProfile } from '../models/ApplicationProfile';
import { DEFAULT_JOB_DETAILS, JobApplicationMethod, JobDetails, normalizeJobDetails } from '../models/JobDetails';
import { Job } from '../models/Job';
import { Resume } from '../models/Resume';
import { scrapeJobListingDetails } from './scrapeService';

type SqliteStatement = {
  run: (...params: unknown[]) => { changes: number; lastInsertRowid: number | bigint };
  get: <T>(...params: unknown[]) => T | undefined;
  all: <T>(...params: unknown[]) => T[];
};
type SqliteDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
};

const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (location: string) => SqliteDatabase;
};

export type TrackedApplicationStatus = 'applying' | 'applied' | 'review_required' | 'failed' | 'skipped';
export type ApplicationTriggerSource = 'manual' | 'bulk';
export type ApplicationProgressStage = 'applied' | 'interviewed';

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

interface TrackedApplicationRow {
  id: string;
  job_id: string;
  job_url: string;
  title: string;
  company: string;
  description: string;
  location: string | null;
  salary: string | null;
  date_posted: string | null;
  match_score: number | null;
  job_details_json: string | null;
  resume_id: string;
  resume_file_name: string;
  resume_content: string | null;
  resume_is_tailored: number;
  resume_source_file_name: string | null;
  tailored_resume_json: string | null;
  cover_letter_text: string | null;
  cover_letter_used: number;
  cover_letter_document_json: string | null;
  cover_letter_file_name: string | null;
  cover_letter_file_path: string | null;
  cover_letter_url: string | null;
  cover_letter_source_resume_id: string | null;
  cover_letter_source_resume_file_name: string | null;
  cover_letter_created_at: string | null;
  trigger_source: ApplicationTriggerSource;
  status: TrackedApplicationStatus;
  message: string;
  logs_json: string;
  artifacts_json: string;
  final_url: string | null;
  steps: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface SummaryCountRow {
  status: TrackedApplicationStatus;
  count: number;
}

interface ColumnInfoRow {
  name: string;
}

const TRACKING_STATUSES: TrackedApplicationStatus[] = [
  'applying',
  'applied',
  'review_required',
  'failed',
  'skipped'
];

const TRACKING_SOURCES: ApplicationTriggerSource[] = ['manual', 'bulk'];
const DEFAULT_HISTORY_LIMIT = 20;
const DEFAULT_ACTIVITY_DAYS = 14;
const DEFAULT_RECENT_APPLICATION_LIMIT = 8;
const DATA_DIR = path.resolve(__dirname, '../../data');
const DATABASE_PATH = process.env.APPLICATION_TRACKING_DB_PATH?.trim()
  ? path.resolve(process.env.APPLICATION_TRACKING_DB_PATH.trim())
  : path.join(DATA_DIR, 'jobfinder.sqlite');

let database: SqliteDatabase | null = null;

const createEmptyStatusCounts = (): Record<TrackedApplicationStatus, number> => ({
  applying: 0,
  applied: 0,
  review_required: 0,
  failed: 0,
  skipped: 0
});

const clampPositiveInteger = (value: number, fallback: number, max: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(value), max);
};

const normalizeOptionalText = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
};

const toDateOnly = (value: string): string => value.slice(0, 10);

const inferApplicationMethodFromUrl = (value?: string | null): JobApplicationMethod => {
  const normalizedUrl = normalizeOptionalText(value);
  if (!normalizedUrl) {
    return '';
  }

  try {
    const { hostname } = new URL(normalizedUrl);
    if (hostname.includes('seek.')) {
      return 'seek';
    }

    return 'company_website';
  } catch {
    return 'other';
  }
};

const inferSuburbOrPostcodeFromLocation = (value?: string | null): string => {
  const normalizedLocation = normalizeOptionalText(value);
  if (!normalizedLocation) {
    return '';
  }

  const postcodeMatch = normalizedLocation.match(/\b\d{4}\b/);
  if (postcodeMatch) {
    return postcodeMatch[0];
  }

  return normalizedLocation.split(',')[0]?.trim() || normalizedLocation;
};

const buildTrackedJobDetails = (
  candidate: Partial<JobDetails> | null | undefined,
  fallback: {
    company?: string | null;
    title?: string | null;
    location?: string | null;
    jobUrl?: string | null;
  }
): JobDetails =>
  normalizeJobDetails({
    ...DEFAULT_JOB_DETAILS,
    employerName: fallback.company || '',
    jobTitle: fallback.title || '',
    jobLocation: fallback.location || '',
    suburbOrPostcode: inferSuburbOrPostcodeFromLocation(fallback.location),
    applicationMethod: inferApplicationMethodFromUrl(fallback.jobUrl),
    ...candidate
  });

const choosePreferredText = (
  currentValue?: string | null,
  candidateValue?: string | null,
  options?: { preferLongerCandidate?: boolean; longerThreshold?: number }
): string | undefined => {
  const current = normalizeOptionalText(currentValue);
  const candidate = normalizeOptionalText(candidateValue);

  if (!candidate) {
    return current;
  }

  if (!current) {
    return candidate;
  }

  if (options?.preferLongerCandidate) {
    const threshold = options.longerThreshold ?? 40;
    if (candidate.length >= current.length + threshold) {
      return candidate;
    }
  }

  return current;
};

const buildInitialJobDetails = (job: Job): JobDetails =>
  buildTrackedJobDetails(undefined, {
    company: job.company,
    title: job.title,
    location: job.location,
    jobUrl: job.url
  });

const buildFinalizedJobDetails = (
  application: TrackedJobApplication | null,
  result: JobApplicationResult,
  completedAt: string
): JobDetails =>
  buildTrackedJobDetails(
    {
      ...application?.jobDetails,
      applicationMethod:
        application?.jobDetails.applicationMethod || inferApplicationMethodFromUrl(result.finalUrl),
      applicationSubmittedDate:
        result.status === 'applied'
          ? application?.jobDetails.applicationSubmittedDate || toDateOnly(completedAt)
          : application?.jobDetails.applicationSubmittedDate || ''
    },
    {
      company: application?.company,
      title: application?.title,
      location: application?.location,
      jobUrl: application?.jobUrl || result.finalUrl
    }
  );

const parseJsonArray = <T>(value: string, fallback: T[]): T[] => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
};

const parseJsonObject = <T>(value: string | null, fallback: T | undefined): T | undefined => {
  try {
    if (!value) {
      return fallback;
    }

    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as T)
      : fallback;
  } catch {
    return fallback;
  }
};

const parseJobDetails = (value: string | null): JobDetails => {
  try {
    return normalizeJobDetails(value ? JSON.parse(value) : undefined);
  } catch {
    return { ...DEFAULT_JOB_DETAILS };
  }
};

const normalizeJobUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.toString();
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
};

const getDatabase = (): SqliteDatabase => {
  if (database) {
    return database;
  }

  fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
  database = new DatabaseSync(DATABASE_PATH);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS job_applications (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      job_url TEXT NOT NULL,
      job_url_normalized TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      description TEXT NOT NULL,
      location TEXT,
      salary TEXT,
      date_posted TEXT,
      match_score INTEGER,
      resume_id TEXT NOT NULL,
      resume_file_name TEXT NOT NULL,
      resume_content TEXT,
      resume_is_tailored INTEGER NOT NULL DEFAULT 0,
      resume_source_file_name TEXT,
      tailored_resume_json TEXT,
      cover_letter_text TEXT,
      cover_letter_used INTEGER NOT NULL DEFAULT 0,
      cover_letter_document_json TEXT,
      cover_letter_file_name TEXT,
      cover_letter_file_path TEXT,
      cover_letter_url TEXT,
      cover_letter_source_resume_id TEXT,
      cover_letter_source_resume_file_name TEXT,
      cover_letter_created_at TEXT,
      application_profile_json TEXT NOT NULL,
      trigger_source TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      logs_json TEXT NOT NULL DEFAULT '[]',
      artifacts_json TEXT NOT NULL DEFAULT '[]',
      final_url TEXT,
      steps INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      CHECK (trigger_source IN ('manual', 'bulk')),
      CHECK (status IN ('applying', 'applied', 'review_required', 'failed', 'skipped'))
    );

    CREATE INDEX IF NOT EXISTS idx_job_applications_job_url_normalized
      ON job_applications (job_url_normalized, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_job_applications_status
      ON job_applications (status, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_job_applications_created_at
      ON job_applications (created_at DESC);
  `);

  const columns = database.prepare(`PRAGMA table_info(job_applications)`).all<ColumnInfoRow>();
  const knownColumns = new Set(columns.map(column => column.name));

  if (!knownColumns.has('cover_letter_text')) {
    database.exec(`ALTER TABLE job_applications ADD COLUMN cover_letter_text TEXT`);
  }

  if (!knownColumns.has('cover_letter_used')) {
    database.exec(`ALTER TABLE job_applications ADD COLUMN cover_letter_used INTEGER NOT NULL DEFAULT 0`);
  }

  if (!knownColumns.has('cover_letter_document_json')) {
    database.exec(`ALTER TABLE job_applications ADD COLUMN cover_letter_document_json TEXT`);
  }

  if (!knownColumns.has('cover_letter_file_name')) {
    database.exec(`ALTER TABLE job_applications ADD COLUMN cover_letter_file_name TEXT`);
  }

  if (!knownColumns.has('cover_letter_file_path')) {
    database.exec(`ALTER TABLE job_applications ADD COLUMN cover_letter_file_path TEXT`);
  }

  if (!knownColumns.has('cover_letter_url')) {
    database.exec(`ALTER TABLE job_applications ADD COLUMN cover_letter_url TEXT`);
  }

  if (!knownColumns.has('cover_letter_source_resume_id')) {
    database.exec(`ALTER TABLE job_applications ADD COLUMN cover_letter_source_resume_id TEXT`);
  }

  if (!knownColumns.has('cover_letter_source_resume_file_name')) {
    database.exec(`ALTER TABLE job_applications ADD COLUMN cover_letter_source_resume_file_name TEXT`);
  }

  if (!knownColumns.has('cover_letter_created_at')) {
    database.exec(`ALTER TABLE job_applications ADD COLUMN cover_letter_created_at TEXT`);
  }

  if (!knownColumns.has('job_details_json')) {
    database.exec(`ALTER TABLE job_applications ADD COLUMN job_details_json TEXT NOT NULL DEFAULT '{}'`);
  }

  if (!knownColumns.has('tailored_resume_json')) {
    database.exec(`ALTER TABLE job_applications ADD COLUMN tailored_resume_json TEXT`);
  }

  if (!knownColumns.has('resume_content')) {
    database.exec(`ALTER TABLE job_applications ADD COLUMN resume_content TEXT`);
  }

  if (!knownColumns.has('resume_is_tailored')) {
    database.exec(`ALTER TABLE job_applications ADD COLUMN resume_is_tailored INTEGER NOT NULL DEFAULT 0`);
  }

  if (!knownColumns.has('resume_source_file_name')) {
    database.exec(`ALTER TABLE job_applications ADD COLUMN resume_source_file_name TEXT`);
  }

  return database;
};

const getCoverLetterDocumentFromRow = (
  row: TrackedApplicationRow
): CoverLetterDocumentSnapshot | undefined => {
  const parsedDocument = parseJsonObject<CoverLetterDocumentSnapshot>(
    row.cover_letter_document_json,
    undefined
  );
  if (parsedDocument) {
    return parsedDocument;
  }

  const fileName = normalizeOptionalText(row.cover_letter_file_name);
  if (!fileName) {
    return undefined;
  }

  return {
    id: `${row.id}-cover-letter`,
    fileName,
    fileType: 'docx',
    content: normalizeOptionalText(row.cover_letter_text) || '',
    filePath: normalizeOptionalText(row.cover_letter_file_path) || '',
    url: normalizeOptionalText(row.cover_letter_url) || '',
    sourceResumeId: normalizeOptionalText(row.cover_letter_source_resume_id) || row.resume_id,
    sourceResumeFileName:
      normalizeOptionalText(row.cover_letter_source_resume_file_name) || row.resume_file_name,
    createdAt: normalizeOptionalText(row.cover_letter_created_at) || row.created_at
  };
};
const mapTrackedApplicationRow = (row: TrackedApplicationRow): TrackedJobApplication => ({
  id: row.id,
  jobId: row.job_id,
  jobUrl: row.job_url,
  title: row.title,
  company: row.company,
  description: row.description,
  location: normalizeOptionalText(row.location),
  salary: normalizeOptionalText(row.salary),
  datePosted: normalizeOptionalText(row.date_posted),
  matchScore: typeof row.match_score === 'number' ? row.match_score : undefined,
  jobDetails: buildTrackedJobDetails(parseJobDetails(row.job_details_json), {
    company: row.company,
    title: row.title,
    location: row.location,
    jobUrl: row.job_url
  }),
  resumeId: row.resume_id,
  resumeFileName: row.resume_file_name,
  resumeContent: row.resume_content || '',
  resumeIsTailored: Boolean(row.resume_is_tailored),
  resumeSourceFileName: normalizeOptionalText(row.resume_source_file_name),
  tailoredResume: parseJsonObject<TailoredResumeSnapshot>(row.tailored_resume_json, undefined),
  coverLetterText: normalizeOptionalText(row.cover_letter_text),
  coverLetterUsed: Boolean(row.cover_letter_used),
  coverLetterDocument: getCoverLetterDocumentFromRow(row),
  triggerSource: row.trigger_source,
  status: row.status,
  message: row.message,
  logs: parseJsonArray<string>(row.logs_json, []),
  artifacts: parseJsonArray<ApplicationArtifact>(row.artifacts_json, []),
  finalUrl: normalizeOptionalText(row.final_url),
  steps: typeof row.steps === 'number' ? row.steps : 0,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  completedAt: normalizeOptionalText(row.completed_at)
});

const getLatestTrackedApplicationByNormalizedUrl = (normalizedJobUrl: string): TrackedJobApplication | null => {
  const row = getDatabase()
    .prepare(
      `
        SELECT
          id,
          job_id,
          job_url,
          title,
          company,
          description,
          location,
          salary,
          date_posted,
          match_score,
          job_details_json,
          resume_id,
          resume_file_name,
          resume_content,
          resume_is_tailored,
          resume_source_file_name,
          tailored_resume_json,
          cover_letter_text,
          cover_letter_used,
          cover_letter_document_json,
          cover_letter_file_name,
          cover_letter_file_path,
          cover_letter_url,
          cover_letter_source_resume_id,
          cover_letter_source_resume_file_name,
          cover_letter_created_at,
          trigger_source,
          status,
          message,
          logs_json,
          artifacts_json,
          final_url,
          steps,
          created_at,
          updated_at,
          completed_at
        FROM job_applications
        WHERE job_url_normalized = ?
        ORDER BY created_at DESC, updated_at DESC
        LIMIT 1
      `
    )
    .get<TrackedApplicationRow>(normalizedJobUrl);

  return row ? mapTrackedApplicationRow(row) : null;
};

const getDateOnlyFromTimestamp = (value?: string): string | null => {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 10);
};

const getSubmittedDateForProgressUpdate = (
  application: TrackedJobApplication,
  fallbackTimestamp: string
): string =>
  application.jobDetails.applicationSubmittedDate ||
  getDateOnlyFromTimestamp(application.completedAt) ||
  getDateOnlyFromTimestamp(application.updatedAt) ||
  getDateOnlyFromTimestamp(application.createdAt) ||
  toDateOnly(fallbackTimestamp);

const getManualProgressMessage = (
  stage: ApplicationProgressStage,
  application: TrackedJobApplication
): string => {
  if (application.status === 'applied') {
    return application.message;
  }

  return stage === 'interviewed'
    ? 'Marked as interviewed from the progress view.'
    : 'Marked as applied from the progress view.';
};

const buildActivityCalendar = (applications: TrackedJobApplication[]): ApplicationActivityPoint[] => {
  const pointsByDay = new Map<string, ApplicationActivityPoint>();

  applications.forEach(application => {
    const appliedDay =
      application.jobDetails.applicationSubmittedDate ||
      getDateOnlyFromTimestamp(application.completedAt) ||
      getDateOnlyFromTimestamp(application.createdAt);

    if (appliedDay) {
      const point = pointsByDay.get(appliedDay) || {
        day: appliedDay,
        totalCount: 0,
        appliedCount: 0,
        interviewedCount: 0,
        employedCount: 0,
        reviewRequiredCount: 0,
        failedCount: 0,
        skippedCount: 0
      };
      point.appliedCount += 1;
      pointsByDay.set(appliedDay, point);
    }

    const updateDay =
      getDateOnlyFromTimestamp(application.updatedAt) ||
      getDateOnlyFromTimestamp(application.completedAt) ||
      getDateOnlyFromTimestamp(application.createdAt);

    if (updateDay && application.jobDetails.interviewedForJob) {
      const point = pointsByDay.get(updateDay) || {
        day: updateDay,
        totalCount: 0,
        appliedCount: 0,
        interviewedCount: 0,
        employedCount: 0,
        reviewRequiredCount: 0,
        failedCount: 0,
        skippedCount: 0
      };
      point.interviewedCount += 1;
      pointsByDay.set(updateDay, point);
    }

    if (updateDay && application.jobDetails.employedForJob) {
      const point = pointsByDay.get(updateDay) || {
        day: updateDay,
        totalCount: 0,
        appliedCount: 0,
        interviewedCount: 0,
        employedCount: 0,
        reviewRequiredCount: 0,
        failedCount: 0,
        skippedCount: 0
      };
      point.employedCount += 1;
      pointsByDay.set(updateDay, point);
    }
  });

  return Array.from(pointsByDay.values())
    .map(point => ({
      ...point,
      totalCount: point.appliedCount + point.interviewedCount + point.employedCount
    }))
    .sort((left, right) => left.day.localeCompare(right.day));
};

const buildRecentActivity = (
  activityCalendar: ApplicationActivityPoint[],
  days: number
): ApplicationActivityPoint[] => {
  const today = new Date();
  const pointsByDay = new Map(activityCalendar.map(point => [point.day, point] as const));
  const points: ApplicationActivityPoint[] = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const pointDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    pointDate.setUTCDate(pointDate.getUTCDate() - offset);
    const day = pointDate.toISOString().slice(0, 10);
    points.push(
      pointsByDay.get(day) || {
        day,
        totalCount: 0,
        appliedCount: 0,
        interviewedCount: 0,
        employedCount: 0,
        reviewRequiredCount: 0,
        failedCount: 0,
        skippedCount: 0
      }
    );
  }

  return points;
};

export const initializeApplicationTracking = (): void => {
  getDatabase();
};

export const createTrackedApplication = (
  job: Job,
  resume: Resume,
  applicationProfile: ApplicationProfile | undefined,
  triggerSource: ApplicationTriggerSource
): TrackedJobApplication => {
  const safeTriggerSource = TRACKING_SOURCES.includes(triggerSource) ? triggerSource : 'manual';
  const id = randomUUID();
  const now = new Date().toISOString();
  const normalizedJobUrl = normalizeJobUrl(job.url);
  const applicationSnapshot = buildApplicationSnapshot(job, resume);
  const jobDetails = buildInitialJobDetails(job);

  getDatabase()
    .prepare(
      `
        INSERT INTO job_applications (
          id,
          job_id,
          job_url,
          job_url_normalized,
          title,
          company,
          description,
          location,
          salary,
          date_posted,
          match_score,
          job_details_json,
          resume_id,
          resume_file_name,
          resume_content,
          resume_is_tailored,
          resume_source_file_name,
          tailored_resume_json,
          cover_letter_text,
          cover_letter_used,
          cover_letter_document_json,
          cover_letter_file_name,
          cover_letter_file_path,
          cover_letter_url,
          cover_letter_source_resume_id,
          cover_letter_source_resume_file_name,
          cover_letter_created_at,
          application_profile_json,
          trigger_source,
          status,
          message,
          logs_json,
          artifacts_json,
          final_url,
          steps,
          created_at,
          updated_at,
          completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      id,
      job.id,
      job.url,
      normalizedJobUrl,
      job.title,
      job.company,
      job.description,
      job.location || null,
      job.salary || null,
      job.datePosted || null,
      typeof job.matchScore === 'number' ? Math.round(job.matchScore) : null,
      JSON.stringify(jobDetails),
      applicationSnapshot.resumeId,
      applicationSnapshot.resumeFileName,
      applicationSnapshot.resumeContent || null,
      applicationSnapshot.resumeIsTailored ? 1 : 0,
      applicationSnapshot.resumeSourceFileName || null,
      applicationSnapshot.tailoredResume ? JSON.stringify(applicationSnapshot.tailoredResume) : null,
      applicationSnapshot.coverLetterText || null,
      applicationSnapshot.coverLetterUsed ? 1 : 0,
      applicationSnapshot.coverLetterDocument ? JSON.stringify(applicationSnapshot.coverLetterDocument) : null,
      applicationSnapshot.coverLetterDocument?.fileName || null,
      applicationSnapshot.coverLetterDocument?.filePath || null,
      applicationSnapshot.coverLetterDocument?.url || null,
      applicationSnapshot.coverLetterDocument?.sourceResumeId || null,
      applicationSnapshot.coverLetterDocument?.sourceResumeFileName || null,
      applicationSnapshot.coverLetterDocument?.createdAt || null,
      JSON.stringify(applicationProfile || null),
      safeTriggerSource,
      'applying',
      'Launching application agent...',
      JSON.stringify([]),
      JSON.stringify([]),
      null,
      0,
      now,
      now,
      null
    );

  return {
    id,
    jobId: job.id,
    jobUrl: job.url,
    title: job.title,
    company: job.company,
    description: job.description,
    location: normalizeOptionalText(job.location),
    salary: normalizeOptionalText(job.salary),
    datePosted: normalizeOptionalText(job.datePosted),
    matchScore: typeof job.matchScore === 'number' ? Math.round(job.matchScore) : undefined,
    jobDetails,
    resumeId: applicationSnapshot.resumeId,
    resumeFileName: applicationSnapshot.resumeFileName,
    resumeContent: applicationSnapshot.resumeContent,
    resumeIsTailored: applicationSnapshot.resumeIsTailored,
    resumeSourceFileName: applicationSnapshot.resumeSourceFileName,
    tailoredResume: applicationSnapshot.tailoredResume,
    coverLetterText: applicationSnapshot.coverLetterText,
    coverLetterUsed: applicationSnapshot.coverLetterUsed,
    coverLetterDocument: applicationSnapshot.coverLetterDocument,
    triggerSource: safeTriggerSource,
    status: 'applying',
    message: 'Launching application agent...',
    logs: [],
    artifacts: [],
    steps: 0,
    createdAt: now,
    updatedAt: now
  };
};

export const finalizeTrackedApplication = (
  applicationId: string,
  result: JobApplicationResult
): TrackedJobApplication | null => {
  const now = new Date().toISOString();
  const applicationSnapshot = result.applicationSnapshot;
  const existingApplication = getTrackedApplicationById(applicationId);
  if (existingApplication?.status === 'skipped' && existingApplication.message === 'Cancelled by user.') {
    return existingApplication;
  }

  const jobDetails = buildFinalizedJobDetails(existingApplication, result, now);

  getDatabase()
    .prepare(
      `
        UPDATE job_applications
        SET
          status = ?,
          message = ?,
          logs_json = ?,
          artifacts_json = ?,
          final_url = ?,
          steps = ?,
          resume_id = ?,
          resume_file_name = ?,
          resume_content = ?,
          resume_is_tailored = ?,
          resume_source_file_name = ?,
          tailored_resume_json = ?,
          cover_letter_text = ?,
          cover_letter_used = ?,
          cover_letter_document_json = ?,
          cover_letter_file_name = ?,
          cover_letter_file_path = ?,
          cover_letter_url = ?,
          cover_letter_source_resume_id = ?,
          cover_letter_source_resume_file_name = ?,
          cover_letter_created_at = ?,
          job_details_json = ?,
          updated_at = ?,
          completed_at = ?
        WHERE id = ?
      `
    )
    .run(
      result.status,
      result.message,
      JSON.stringify(result.logs || []),
      JSON.stringify(result.artifacts || []),
      result.finalUrl || null,
      typeof result.steps === 'number' ? result.steps : 0,
      applicationSnapshot.resumeId,
      applicationSnapshot.resumeFileName,
      applicationSnapshot.resumeContent || null,
      applicationSnapshot.resumeIsTailored ? 1 : 0,
      applicationSnapshot.resumeSourceFileName || null,
      applicationSnapshot.tailoredResume ? JSON.stringify(applicationSnapshot.tailoredResume) : null,
      applicationSnapshot.coverLetterText || null,
      applicationSnapshot.coverLetterUsed ? 1 : 0,
      applicationSnapshot.coverLetterDocument ? JSON.stringify(applicationSnapshot.coverLetterDocument) : null,
      applicationSnapshot.coverLetterDocument?.fileName || null,
      applicationSnapshot.coverLetterDocument?.filePath || null,
      applicationSnapshot.coverLetterDocument?.url || null,
      applicationSnapshot.coverLetterDocument?.sourceResumeId || null,
      applicationSnapshot.coverLetterDocument?.sourceResumeFileName || null,
      applicationSnapshot.coverLetterDocument?.createdAt || null,
      JSON.stringify(jobDetails),
      now,
      now,
      applicationId
    );

  return getTrackedApplicationById(applicationId);
};

export const failTrackedApplication = (applicationId: string, message: string): TrackedJobApplication | null => {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
        UPDATE job_applications
        SET
          status = 'failed',
          message = ?,
          updated_at = ?,
          completed_at = ?
        WHERE id = ?
      `
    )
    .run(message, now, now, applicationId);

  return getTrackedApplicationById(applicationId);
};

export const markTrackedApplicationSkipped = (
  applicationId: string,
  message: string
): TrackedJobApplication | null => {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
        UPDATE job_applications
        SET
          status = 'skipped',
          message = ?,
          updated_at = ?,
          completed_at = ?
        WHERE id = ?
      `
    )
    .run(message, now, now, applicationId);

  return getTrackedApplicationById(applicationId);
};

export const updateTrackedApplicationJobDetails = (
  applicationId: string,
  jobDetails: JobDetails
): TrackedJobApplication | null => {
  const now = new Date().toISOString();
  const result = getDatabase()
    .prepare(
      `
        UPDATE job_applications
        SET
          job_details_json = ?,
          updated_at = ?
        WHERE id = ?
      `
    )
    .run(JSON.stringify(normalizeJobDetails(jobDetails)), now, applicationId);

  if (result.changes === 0) {
    return null;
  }

  return getTrackedApplicationById(applicationId);
};

export const updateTrackedApplicationProgress = (
  applicationId: string,
  stage: ApplicationProgressStage
): TrackedJobApplication | null => {
  const existingApplication = getTrackedApplicationById(applicationId);

  if (!existingApplication) {
    return null;
  }

  const now = new Date().toISOString();
  const nextJobDetails = normalizeJobDetails({
    ...existingApplication.jobDetails,
    applicationSubmittedDate: getSubmittedDateForProgressUpdate(existingApplication, now),
    interviewedForJob:
      stage === 'interviewed' ? true : existingApplication.jobDetails.interviewedForJob
  });
  const nextStatus: TrackedApplicationStatus = 'applied';
  const nextMessage = getManualProgressMessage(stage, existingApplication);

  const hasChanges =
    existingApplication.status !== nextStatus ||
    existingApplication.message !== nextMessage ||
    JSON.stringify(existingApplication.jobDetails) !== JSON.stringify(nextJobDetails);

  if (!hasChanges) {
    return existingApplication;
  }

  const result = getDatabase()
    .prepare(
      `
        UPDATE job_applications
        SET
          status = ?,
          message = ?,
          job_details_json = ?,
          updated_at = ?
        WHERE id = ?
      `
    )
    .run(nextStatus, nextMessage, JSON.stringify(nextJobDetails), now, applicationId);

  if (result.changes === 0) {
    return null;
  }

  return getTrackedApplicationById(applicationId);
};

export const enrichTrackedApplicationFromListing = async (
  applicationId: string
): Promise<TrackedJobApplication | null> => {
  const existingApplication = getTrackedApplicationById(applicationId);

  if (!existingApplication) {
    return null;
  }

  const scrapedDetails = await scrapeJobListingDetails(existingApplication.jobUrl);
  const nextTitle = choosePreferredText(existingApplication.title, scrapedDetails.title) || existingApplication.title;
  const nextCompany =
    choosePreferredText(existingApplication.company, scrapedDetails.company) || existingApplication.company;
  const nextDescription =
    choosePreferredText(existingApplication.description, scrapedDetails.description, {
      preferLongerCandidate: true,
      longerThreshold: 20
    }) || existingApplication.description;
  const nextLocation =
    choosePreferredText(existingApplication.location, scrapedDetails.location) || existingApplication.location;
  const nextSalary =
    choosePreferredText(existingApplication.salary, scrapedDetails.salary) || existingApplication.salary;
  const nextDatePosted =
    choosePreferredText(existingApplication.datePosted, scrapedDetails.datePosted) || existingApplication.datePosted;
  const nextJobDetails = buildTrackedJobDetails(
    {
      ...existingApplication.jobDetails,
      employerName:
        existingApplication.jobDetails.employerName ||
        scrapedDetails.company ||
        nextCompany,
      jobTitle:
        existingApplication.jobDetails.jobTitle ||
        scrapedDetails.title ||
        nextTitle,
      jobLocation:
        existingApplication.jobDetails.jobLocation ||
        scrapedDetails.location ||
        nextLocation ||
        '',
      suburbOrPostcode:
        existingApplication.jobDetails.suburbOrPostcode ||
        scrapedDetails.suburbOrPostcode ||
        inferSuburbOrPostcodeFromLocation(scrapedDetails.location || nextLocation)
    },
    {
      company: nextCompany,
      title: nextTitle,
      location: nextLocation,
      jobUrl: existingApplication.jobUrl
    }
  );

  const changed =
    nextTitle !== existingApplication.title ||
    nextCompany !== existingApplication.company ||
    nextDescription !== existingApplication.description ||
    nextLocation !== existingApplication.location ||
    nextSalary !== existingApplication.salary ||
    nextDatePosted !== existingApplication.datePosted ||
    JSON.stringify(nextJobDetails) !== JSON.stringify(existingApplication.jobDetails);

  if (!changed) {
    return existingApplication;
  }

  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `
        UPDATE job_applications
        SET
          title = ?,
          company = ?,
          description = ?,
          location = ?,
          salary = ?,
          date_posted = ?,
          job_details_json = ?,
          updated_at = ?
        WHERE id = ?
      `
    )
    .run(
      nextTitle,
      nextCompany,
      nextDescription,
      nextLocation || null,
      nextSalary || null,
      nextDatePosted || null,
      JSON.stringify(nextJobDetails),
      now,
      applicationId
    );

  return getTrackedApplicationById(applicationId);
};

export const getTrackedApplicationById = (applicationId: string): TrackedJobApplication | null => {
  const row = getDatabase()
    .prepare(
      `
        SELECT
          id,
          job_id,
          job_url,
          title,
          company,
          description,
          location,
          salary,
          date_posted,
          match_score,
          job_details_json,
          resume_id,
          resume_file_name,
          resume_content,
          resume_is_tailored,
          resume_source_file_name,
          tailored_resume_json,
          cover_letter_text,
          cover_letter_used,
          cover_letter_document_json,
          cover_letter_file_name,
          cover_letter_file_path,
          cover_letter_url,
          cover_letter_source_resume_id,
          cover_letter_source_resume_file_name,
          cover_letter_created_at,
          trigger_source,
          status,
          message,
          logs_json,
          artifacts_json,
          final_url,
          steps,
          created_at,
          updated_at,
          completed_at
        FROM job_applications
        WHERE id = ?
        LIMIT 1
      `
    )
    .get<TrackedApplicationRow>(applicationId);

  return row ? mapTrackedApplicationRow(row) : null;
};

export const listTrackedApplications = (limit = DEFAULT_HISTORY_LIMIT): TrackedJobApplication[] => {
  const safeLimit = clampPositiveInteger(limit, DEFAULT_HISTORY_LIMIT, 200);
  const rows = getDatabase()
    .prepare(
      `
        SELECT
          id,
          job_id,
          job_url,
          title,
          company,
          description,
          location,
          salary,
          date_posted,
          match_score,
          job_details_json,
          resume_id,
          resume_file_name,
          resume_content,
          resume_is_tailored,
          resume_source_file_name,
          tailored_resume_json,
          cover_letter_text,
          cover_letter_used,
          cover_letter_document_json,
          cover_letter_file_name,
          cover_letter_file_path,
          cover_letter_url,
          cover_letter_source_resume_id,
          cover_letter_source_resume_file_name,
          cover_letter_created_at,
          trigger_source,
          status,
          message,
          logs_json,
          artifacts_json,
          final_url,
          steps,
          created_at,
          updated_at,
          completed_at
        FROM job_applications
        ORDER BY created_at DESC, updated_at DESC
        LIMIT ?
      `
    )
    .all<TrackedApplicationRow>(safeLimit);

  return rows.map(mapTrackedApplicationRow);
};

const listAllTrackedApplications = (): TrackedJobApplication[] => {
  const rows = getDatabase()
    .prepare(
      `
        SELECT
          id,
          job_id,
          job_url,
          title,
          company,
          description,
          location,
          salary,
          date_posted,
          match_score,
          job_details_json,
          resume_id,
          resume_file_name,
          resume_content,
          resume_is_tailored,
          resume_source_file_name,
          tailored_resume_json,
          cover_letter_text,
          cover_letter_used,
          cover_letter_document_json,
          cover_letter_file_name,
          cover_letter_file_path,
          cover_letter_url,
          cover_letter_source_resume_id,
          cover_letter_source_resume_file_name,
          cover_letter_created_at,
          trigger_source,
          status,
          message,
          logs_json,
          artifacts_json,
          final_url,
          steps,
          created_at,
          updated_at,
          completed_at
        FROM job_applications
        ORDER BY created_at DESC, updated_at DESC
      `
    )
    .all<TrackedApplicationRow>();

  return rows.map(mapTrackedApplicationRow);
};

export const getTrackedApplicationsByJobUrls = (jobUrls: string[]): TrackedJobApplication[] => {
  const uniqueNormalizedUrls = Array.from(
    new Set(
      jobUrls
        .map(jobUrl => normalizeJobUrl(jobUrl))
        .filter(Boolean)
    )
  );

  return uniqueNormalizedUrls
    .map(jobUrl => getLatestTrackedApplicationByNormalizedUrl(jobUrl))
    .filter((application): application is TrackedJobApplication => Boolean(application));
};

export const getApplicationTrackingSummary = (
  days = DEFAULT_ACTIVITY_DAYS,
  recentLimit = DEFAULT_RECENT_APPLICATION_LIMIT
): ApplicationTrackingSummary => {
  const safeDays = clampPositiveInteger(days, DEFAULT_ACTIVITY_DAYS, 90);
  const safeRecentLimit = clampPositiveInteger(recentLimit, DEFAULT_RECENT_APPLICATION_LIMIT, 50);
  const recentApplications = listTrackedApplications(safeRecentLimit);
  const allApplications = listAllTrackedApplications();
  const activityCalendar = buildActivityCalendar(allApplications);
  const statusCounts = createEmptyStatusCounts();

  getDatabase()
    .prepare(
      `
        SELECT status, COUNT(*) as count
        FROM job_applications
        GROUP BY status
      `
    )
    .all<SummaryCountRow>()
    .forEach(row => {
      if (TRACKING_STATUSES.includes(row.status)) {
        statusCounts[row.status] = Number(row.count) || 0;
      }
    });

  const totalApplications = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
  const completedApplications =
    statusCounts.applied + statusCounts.review_required + statusCounts.failed + statusCounts.skipped;
  const successfulApplications = statusCounts.applied;
  const successRate =
    completedApplications > 0
      ? Math.round((successfulApplications / completedApplications) * 1000) / 10
      : 0;
  const appliedCount = allApplications.filter(
    application =>
      application.status === 'applied' || Boolean(application.jobDetails.applicationSubmittedDate)
  ).length;
  const interviewedCount = allApplications.filter(application => application.jobDetails.interviewedForJob).length;
  const employedCount = allApplications.filter(application => application.jobDetails.employedForJob).length;
  const activityYears = Array.from(
    new Set(activityCalendar.map(point => Number(point.day.slice(0, 4))).filter(Number.isFinite))
  ).sort((left, right) => right - left);

  return {
    totalApplications,
    completedApplications,
    successfulApplications,
    successRate,
    appliedCount,
    interviewedCount,
    employedCount,
    statusCounts,
    recentActivity: buildRecentActivity(activityCalendar, safeDays),
    activityCalendar,
    activityYears,
    recentApplications
  };
};
