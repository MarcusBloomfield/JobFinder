import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

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

export type HumanInterventionReason =
  | 'final_submission_approval'
  | 'captcha'
  | 'mfa'
  | 'missing_information'
  | 'unsupported_declaration'
  | 'manual_review'
  | 'unknown';

export type HumanInterventionStatus = 'pending' | 'continued' | 'skipped' | 'failed';
export type HumanInterventionResolutionAction = Exclude<HumanInterventionStatus, 'pending'>;

export interface HumanInterventionInput {
  applicationId?: string;
  reason: HumanInterventionReason;
  title: string;
  message: string;
  pageUrl?: string;
  screenshotFilePath?: string;
  screenshotUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface HumanInterventionRecord extends HumanInterventionInput {
  id: string;
  status: HumanInterventionStatus;
  resolutionMessage?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

interface HumanInterventionRow {
  id: string;
  application_id: string | null;
  reason: HumanInterventionReason;
  title: string;
  message: string;
  page_url: string | null;
  screenshot_file_path: string | null;
  screenshot_url: string | null;
  metadata_json: string | null;
  status: HumanInterventionStatus;
  resolution_message: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface HumanInterventionScreenshot {
  filePath?: string;
  url?: string;
}

const DATA_DIR = path.resolve(__dirname, '../../data');
const DATABASE_PATH = process.env.APPLICATION_TRACKING_DB_PATH?.trim()
  ? path.resolve(process.env.APPLICATION_TRACKING_DB_PATH.trim())
  : path.join(DATA_DIR, 'jobfinder.sqlite');

const REASONS: HumanInterventionReason[] = [
  'final_submission_approval',
  'captcha',
  'mfa',
  'missing_information',
  'unsupported_declaration',
  'manual_review',
  'unknown'
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

    CREATE TABLE IF NOT EXISTS human_interventions (
      id TEXT PRIMARY KEY,
      application_id TEXT,
      reason TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      page_url TEXT,
      screenshot_file_path TEXT,
      screenshot_url TEXT,
      metadata_json TEXT,
      status TEXT NOT NULL,
      resolution_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT,
      CHECK (reason IN (
        'final_submission_approval',
        'captcha',
        'mfa',
        'missing_information',
        'unsupported_declaration',
        'manual_review',
        'unknown'
      )),
      CHECK (status IN ('pending', 'continued', 'skipped', 'failed'))
    );

    CREATE INDEX IF NOT EXISTS idx_human_interventions_status_created_at
      ON human_interventions (status, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_human_interventions_application_id
      ON human_interventions (application_id, created_at DESC);
  `);

  return database;
};

const mapHumanInterventionRow = (row: HumanInterventionRow): HumanInterventionRecord => ({
  id: row.id,
  applicationId: normalizeOptionalText(row.application_id),
  reason: REASONS.includes(row.reason) ? row.reason : 'unknown',
  title: row.title,
  message: row.message,
  pageUrl: normalizeOptionalText(row.page_url),
  screenshotFilePath: normalizeOptionalText(row.screenshot_file_path),
  screenshotUrl: normalizeOptionalText(row.screenshot_url),
  metadata: parseMetadata(row.metadata_json),
  status: row.status,
  resolutionMessage: normalizeOptionalText(row.resolution_message),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  resolvedAt: normalizeOptionalText(row.resolved_at)
});

export const initializeHumanInterventions = (): void => {
  getDatabase();
};

export const createHumanIntervention = (
  intervention: HumanInterventionInput
): HumanInterventionRecord => {
  const id = randomUUID();
  const now = new Date().toISOString();
  const reason = REASONS.includes(intervention.reason) ? intervention.reason : 'unknown';

  getDatabase()
    .prepare(
      `
        INSERT INTO human_interventions (
          id,
          application_id,
          reason,
          title,
          message,
          page_url,
          screenshot_file_path,
          screenshot_url,
          metadata_json,
          status,
          resolution_message,
          created_at,
          updated_at,
          resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, NULL)
      `
    )
    .run(
      id,
      intervention.applicationId || null,
      reason,
      intervention.title,
      intervention.message,
      intervention.pageUrl || null,
      intervention.screenshotFilePath || null,
      intervention.screenshotUrl || null,
      intervention.metadata ? JSON.stringify(intervention.metadata) : null,
      now,
      now
    );

  const created = getHumanInterventionById(id);
  if (!created) {
    throw new Error('Failed to create intervention.');
  }

  return created;
};

export const listPendingHumanInterventions = (): HumanInterventionRecord[] => {
  const rows = getDatabase()
    .prepare(
      `
        SELECT *
        FROM human_interventions
        WHERE status = 'pending'
        ORDER BY created_at ASC
      `
    )
    .all<HumanInterventionRow>();

  return rows.map(mapHumanInterventionRow);
};

export const listHumanInterventionsForApplication = (
  applicationId: string
): HumanInterventionRecord[] => {
  const rows = getDatabase()
    .prepare(
      `
        SELECT *
        FROM human_interventions
        WHERE application_id = ?
        ORDER BY created_at DESC
      `
    )
    .all<HumanInterventionRow>(applicationId);

  return rows.map(mapHumanInterventionRow);
};

export const getHumanInterventionById = (
  interventionId: string
): HumanInterventionRecord | null => {
  const row = getDatabase()
    .prepare(
      `
        SELECT *
        FROM human_interventions
        WHERE id = ?
        LIMIT 1
      `
    )
    .get<HumanInterventionRow>(interventionId);

  return row ? mapHumanInterventionRow(row) : null;
};

export const resolveHumanIntervention = (
  interventionId: string,
  action: HumanInterventionResolutionAction,
  resolutionMessage?: string
): HumanInterventionRecord | null => {
  const now = new Date().toISOString();
  const result = getDatabase()
    .prepare(
      `
        UPDATE human_interventions
        SET
          status = ?,
          resolution_message = ?,
          updated_at = ?,
          resolved_at = ?
        WHERE id = ?
          AND status = 'pending'
      `
    )
    .run(action, resolutionMessage || null, now, now, interventionId);

  if (result.changes === 0) {
    return null;
  }

  return getHumanInterventionById(interventionId);
};

export const getHumanInterventionScreenshot = (
  interventionId: string
): HumanInterventionScreenshot | null => {
  const intervention = getHumanInterventionById(interventionId);
  if (!intervention) {
    return null;
  }

  return {
    filePath: intervention.screenshotFilePath,
    url: intervention.screenshotUrl
  };
};

export const waitForHumanInterventionResolution = async (
  interventionId: string,
  timeoutMs = 30 * 60 * 1000,
  pollMs = 1000
): Promise<HumanInterventionRecord> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const intervention = getHumanInterventionById(interventionId);
    if (!intervention) {
      throw new Error('Intervention not found.');
    }

    if (intervention.status !== 'pending') {
      return intervention;
    }

    await new Promise(resolve => setTimeout(resolve, Math.max(250, pollMs)));
  }

  throw new Error('Intervention timed out.');
};
