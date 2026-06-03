import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  ApplicationArtifact,
  ApplicationSnapshot,
  JobApplicationResult,
  buildApplicationSnapshot
} from './applicationAgentService';
import { ApplicationProfile } from '../models/ApplicationProfile';
import { Job } from '../models/Job';
import { Resume } from '../models/Resume';

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
  resume_id: string;
  resume_file_name: string;
  cover_letter_text: string | null;
  cover_letter_used: number;
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

interface ActivityRow {
  day: string;
  total_count: number;
  applied_count: number;
  review_required_count: number;
  failed_count: number;
  skipped_count: number;
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

const parseJsonArray = <T>(value: string, fallback: T[]): T[] => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
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

  return database;
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
  resumeId: row.resume_id,
  resumeFileName: row.resume_file_name,
  coverLetterText: normalizeOptionalText(row.cover_letter_text),
  coverLetterUsed: Boolean(row.cover_letter_used),
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
          resume_id,
          resume_file_name,
          cover_letter_text,
          cover_letter_used,
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

const buildRecentActivity = (rows: ActivityRow[], days: number): ApplicationActivityPoint[] => {
  const today = new Date();
  const pointsByDay = new Map(
    rows.map(row => [
      row.day,
      {
        day: row.day,
        totalCount: Number(row.total_count) || 0,
        appliedCount: Number(row.applied_count) || 0,
        reviewRequiredCount: Number(row.review_required_count) || 0,
        failedCount: Number(row.failed_count) || 0,
        skippedCount: Number(row.skipped_count) || 0
      }
    ] as const)
  );

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
          resume_id,
          resume_file_name,
          cover_letter_text,
          cover_letter_used,
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      applicationSnapshot.resumeId,
      applicationSnapshot.resumeFileName,
      applicationSnapshot.coverLetterText || null,
      applicationSnapshot.coverLetterUsed ? 1 : 0,
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
    resumeId: applicationSnapshot.resumeId,
    resumeFileName: applicationSnapshot.resumeFileName,
    coverLetterText: applicationSnapshot.coverLetterText,
    coverLetterUsed: applicationSnapshot.coverLetterUsed,
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
          cover_letter_text = ?,
          cover_letter_used = ?,
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
      applicationSnapshot.coverLetterText || null,
      applicationSnapshot.coverLetterUsed ? 1 : 0,
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
          resume_id,
          resume_file_name,
          cover_letter_text,
          cover_letter_used,
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
          resume_id,
          resume_file_name,
          cover_letter_text,
          cover_letter_used,
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

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (safeDays - 1));
  const recentActivityRows = getDatabase()
    .prepare(
      `
        SELECT
          substr(created_at, 1, 10) as day,
          COUNT(*) as total_count,
          SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) as applied_count,
          SUM(CASE WHEN status = 'review_required' THEN 1 ELSE 0 END) as review_required_count,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
          SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped_count
        FROM job_applications
        WHERE created_at >= ?
        GROUP BY substr(created_at, 1, 10)
        ORDER BY day ASC
      `
    )
    .all<ActivityRow>(since.toISOString());

  return {
    totalApplications,
    completedApplications,
    successfulApplications,
    successRate,
    statusCounts,
    recentActivity: buildRecentActivity(recentActivityRows, safeDays),
    recentApplications
  };
};
