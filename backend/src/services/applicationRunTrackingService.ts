import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { ApplicationPlatform, detectPlatform } from './applicationPlatformService';

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

export type ApplicationRunStatus =
  | 'running'
  | 'waiting_for_user'
  | 'ready_for_review'
  | 'submitted'
  | 'skipped'
  | 'failed';

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
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface CreateApplicationRunInput {
  applicationId: string;
  platform?: string;
  currentStep?: number;
  currentUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface ApplicationRunUpdateInput {
  status?: ApplicationRunStatus;
  platform?: string;
  currentStep?: number;
  currentUrl?: string;
  errorMessage?: string;
  errorStack?: string;
  screenshotFilePath?: string;
  screenshotUrl?: string;
  snapshotFilePath?: string;
  snapshotUrl?: string;
  metadata?: Record<string, unknown>;
  completed?: boolean;
}

interface ApplicationRunRow {
  id: string;
  application_id: string;
  status: ApplicationRunStatus;
  platform: string;
  current_step: number;
  current_url: string | null;
  error_message: string | null;
  error_stack: string | null;
  screenshot_file_path: string | null;
  screenshot_url: string | null;
  snapshot_file_path: string | null;
  snapshot_url: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const DATA_DIR = path.resolve(__dirname, '../../data');
const DATABASE_PATH = process.env.APPLICATION_TRACKING_DB_PATH?.trim()
  ? path.resolve(process.env.APPLICATION_TRACKING_DB_PATH.trim())
  : path.join(DATA_DIR, 'jobfinder.sqlite');

const RUN_STATUSES: ApplicationRunStatus[] = [
  'running',
  'waiting_for_user',
  'ready_for_review',
  'submitted',
  'skipped',
  'failed'
];

let database: SqliteDatabase | null = null;

const normalizeOptionalText = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
};

const parseMetadata = (value: string | null): Record<string, unknown> | undefined => {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
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

    CREATE TABLE IF NOT EXISTS application_runs (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      status TEXT NOT NULL,
      platform TEXT NOT NULL,
      current_step INTEGER NOT NULL DEFAULT 0,
      current_url TEXT,
      error_message TEXT,
      error_stack TEXT,
      screenshot_file_path TEXT,
      screenshot_url TEXT,
      snapshot_file_path TEXT,
      snapshot_url TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      CHECK (status IN (
        'running',
        'waiting_for_user',
        'ready_for_review',
        'submitted',
        'skipped',
        'failed'
      ))
    );

    CREATE INDEX IF NOT EXISTS idx_application_runs_application_id
      ON application_runs (application_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_application_runs_status
      ON application_runs (status, updated_at DESC);
  `);

  return database;
};

const mapApplicationRunRow = (row: ApplicationRunRow): ApplicationRunRecord => ({
  id: row.id,
  applicationId: row.application_id,
  status: RUN_STATUSES.includes(row.status) ? row.status : 'failed',
  platform: row.platform,
  currentStep: typeof row.current_step === 'number' ? row.current_step : 0,
  currentUrl: normalizeOptionalText(row.current_url),
  errorMessage: normalizeOptionalText(row.error_message),
  errorStack: normalizeOptionalText(row.error_stack),
  screenshotFilePath: normalizeOptionalText(row.screenshot_file_path),
  screenshotUrl: normalizeOptionalText(row.screenshot_url),
  snapshotFilePath: normalizeOptionalText(row.snapshot_file_path),
  snapshotUrl: normalizeOptionalText(row.snapshot_url),
  metadata: parseMetadata(row.metadata_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  completedAt: normalizeOptionalText(row.completed_at)
});

const isTerminalStatus = (status: ApplicationRunStatus): boolean =>
  status === 'submitted' || status === 'skipped' || status === 'failed';

export const initializeApplicationRunTracking = (): void => {
  getDatabase();
};

export const inferApplicationPlatform = (url?: string | null): ApplicationPlatform => {
  return detectPlatform(url);
};

export const createApplicationRun = (input: CreateApplicationRunInput): ApplicationRunRecord => {
  const id = randomUUID();
  const now = new Date().toISOString();
  const platform = normalizeOptionalText(input.platform) || 'unknown';

  getDatabase()
    .prepare(
      `
        INSERT INTO application_runs (
          id,
          application_id,
          status,
          platform,
          current_step,
          current_url,
          error_message,
          error_stack,
          screenshot_file_path,
          screenshot_url,
          snapshot_file_path,
          snapshot_url,
          metadata_json,
          created_at,
          updated_at,
          completed_at
        ) VALUES (?, ?, 'running', ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, NULL)
      `
    )
    .run(
      id,
      input.applicationId,
      platform,
      Math.max(0, Math.floor(input.currentStep || 0)),
      input.currentUrl || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
      now
    );

  const created = getApplicationRunById(id);
  if (!created) {
    throw new Error('Failed to create application run.');
  }

  return created;
};

export const updateApplicationRun = (
  runId: string,
  updates: ApplicationRunUpdateInput
): ApplicationRunRecord | null => {
  const existing = getApplicationRunById(runId);
  if (!existing) {
    return null;
  }

  const status = updates.status || existing.status;
  const now = new Date().toISOString();
  const completedAt =
    updates.completed || isTerminalStatus(status)
      ? existing.completedAt || now
      : existing.completedAt || undefined;

  const result = getDatabase()
    .prepare(
      `
        UPDATE application_runs
        SET
          status = ?,
          platform = ?,
          current_step = ?,
          current_url = ?,
          error_message = ?,
          error_stack = ?,
          screenshot_file_path = ?,
          screenshot_url = ?,
          snapshot_file_path = ?,
          snapshot_url = ?,
          metadata_json = ?,
          updated_at = ?,
          completed_at = ?
        WHERE id = ?
      `
    )
    .run(
      status,
      normalizeOptionalText(updates.platform) || existing.platform,
      typeof updates.currentStep === 'number'
        ? Math.max(0, Math.floor(updates.currentStep))
        : existing.currentStep,
      updates.currentUrl !== undefined ? updates.currentUrl || null : existing.currentUrl || null,
      updates.errorMessage !== undefined ? updates.errorMessage || null : existing.errorMessage || null,
      updates.errorStack !== undefined ? updates.errorStack || null : existing.errorStack || null,
      updates.screenshotFilePath !== undefined
        ? updates.screenshotFilePath || null
        : existing.screenshotFilePath || null,
      updates.screenshotUrl !== undefined ? updates.screenshotUrl || null : existing.screenshotUrl || null,
      updates.snapshotFilePath !== undefined
        ? updates.snapshotFilePath || null
        : existing.snapshotFilePath || null,
      updates.snapshotUrl !== undefined ? updates.snapshotUrl || null : existing.snapshotUrl || null,
      updates.metadata !== undefined
        ? JSON.stringify(updates.metadata)
        : existing.metadata
          ? JSON.stringify(existing.metadata)
          : null,
      now,
      completedAt || null,
      runId
    );

  if (result.changes === 0) {
    return null;
  }

  return getApplicationRunById(runId);
};

export const updateApplicationRunStatusAndStep = (
  runId: string,
  status: ApplicationRunStatus,
  currentStep: number,
  currentUrl?: string
): ApplicationRunRecord | null =>
  updateApplicationRun(runId, {
    status,
    currentStep,
    currentUrl
  });

export const markApplicationRunWaitingForUser = (
  runId: string,
  updates: Omit<ApplicationRunUpdateInput, 'status'> = {}
): ApplicationRunRecord | null =>
  updateApplicationRun(runId, {
    ...updates,
    status: 'waiting_for_user'
  });

export const markApplicationRunReadyForReview = (
  runId: string,
  updates: Omit<ApplicationRunUpdateInput, 'status'> = {}
): ApplicationRunRecord | null =>
  updateApplicationRun(runId, {
    ...updates,
    status: 'ready_for_review'
  });

export const markApplicationRunSubmitted = (
  runId: string,
  updates: Omit<ApplicationRunUpdateInput, 'status' | 'completed'> = {}
): ApplicationRunRecord | null =>
  updateApplicationRun(runId, {
    ...updates,
    status: 'submitted',
    completed: true
  });

export const markApplicationRunSkipped = (
  runId: string,
  updates: Omit<ApplicationRunUpdateInput, 'status' | 'completed'> = {}
): ApplicationRunRecord | null =>
  updateApplicationRun(runId, {
    ...updates,
    status: 'skipped',
    completed: true
  });

export const markApplicationRunFailed = (
  runId: string,
  updates: Omit<ApplicationRunUpdateInput, 'status' | 'completed'> = {}
): ApplicationRunRecord | null =>
  updateApplicationRun(runId, {
    ...updates,
    status: 'failed',
    completed: true
  });

export const getApplicationRunById = (runId: string): ApplicationRunRecord | null => {
  const row = getDatabase()
    .prepare(
      `
        SELECT *
        FROM application_runs
        WHERE id = ?
        LIMIT 1
      `
    )
    .get<ApplicationRunRow>(runId);

  return row ? mapApplicationRunRow(row) : null;
};

export interface ListApplicationRunsOptions {
  applicationId?: string;
  status?: ApplicationRunStatus;
  limit?: number;
}

export const listApplicationRuns = (
  options: ListApplicationRunsOptions = {}
): ApplicationRunRecord[] => {
  const filters: string[] = [];
  const params: unknown[] = [];

  if (options.applicationId) {
    filters.push('application_id = ?');
    params.push(options.applicationId);
  }

  if (options.status && RUN_STATUSES.includes(options.status)) {
    filters.push('status = ?');
    params.push(options.status);
  }

  const limit = Math.max(1, Math.min(200, Math.floor(options.limit || 50)));
  params.push(limit);

  const whereSql = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = getDatabase()
    .prepare(
      `
        SELECT *
        FROM application_runs
        ${whereSql}
        ORDER BY created_at DESC
        LIMIT ?
      `
    )
    .all<ApplicationRunRow>(...params);

  return rows.map(mapApplicationRunRow);
};

export const listApplicationRunsForApplication = (
  applicationId: string
): ApplicationRunRecord[] => {
  const rows = getDatabase()
    .prepare(
      `
        SELECT *
        FROM application_runs
        WHERE application_id = ?
        ORDER BY created_at DESC
      `
    )
    .all<ApplicationRunRow>(applicationId);

  return rows.map(mapApplicationRunRow);
};
