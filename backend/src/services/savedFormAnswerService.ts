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

export const SAVED_FORM_ANSWER_CONTROL_KINDS = [
  'text',
  'textarea',
  'select',
  'checkbox',
  'radio',
  'file',
  'unknown'
] as const;

export type SavedFormAnswerControlKind = (typeof SAVED_FORM_ANSWER_CONTROL_KINDS)[number];

export const SAVED_FORM_ANSWER_SAFETY_CATEGORIES = [
  'safe',
  'legal',
  'work_rights',
  'salary',
  'demographic',
  'availability',
  'certification',
  'degree',
  'clearance',
  'reference',
  'uncertain',
  'unsupported'
] as const;

export type SavedFormAnswerSafetyCategory = (typeof SAVED_FORM_ANSWER_SAFETY_CATEGORIES)[number];

export interface SavedFormAnswer {
  id: string;
  question: string;
  normalizedQuestion: string;
  answer: string;
  normalizedAnswer: string;
  controlKind: SavedFormAnswerControlKind;
  safetyCategory: SavedFormAnswerSafetyCategory;
  explicitlyApproved: boolean;
  allowAutoReuse: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSavedFormAnswerInput {
  question: string;
  answer: string;
  controlKind?: SavedFormAnswerControlKind | string;
  safetyCategory?: SavedFormAnswerSafetyCategory | string;
  explicitlyApproved?: boolean;
  allowAutoReuse?: boolean;
}

export interface UpdateSavedFormAnswerInput {
  question?: string;
  answer?: string;
  controlKind?: SavedFormAnswerControlKind | string;
  safetyCategory?: SavedFormAnswerSafetyCategory | string;
  explicitlyApproved?: boolean;
  allowAutoReuse?: boolean;
}

export interface SavedFormAnswerMatchOptions {
  question: string;
  controlKind?: SavedFormAnswerControlKind | string;
  options?: Array<{ label?: string; value?: string }>;
}

interface SavedFormAnswerRow {
  id: string;
  question: string;
  normalized_question: string;
  answer: string;
  normalized_answer: string;
  control_kind: SavedFormAnswerControlKind;
  safety_category: SavedFormAnswerSafetyCategory;
  explicitly_approved: number;
  allow_auto_reuse: number;
  created_at: string;
  updated_at: string;
}

interface ColumnInfoRow {
  name: string;
}

const DATA_DIR = path.resolve(__dirname, '../../data');
const DATABASE_PATH = process.env.APPLICATION_TRACKING_DB_PATH?.trim()
  ? path.resolve(process.env.APPLICATION_TRACKING_DB_PATH.trim())
  : path.join(DATA_DIR, 'jobfinder.sqlite');

const TRUE_PATTERN = /^(true|yes|y|1|checked|check|on)$/i;
const FALSE_PATTERN = /^(false|no|n|0|unchecked|uncheck|off)$/i;
const AUTO_REUSE_MIN_SCORE = 0.93;
const AUTO_REUSE_MIN_SHARED_TOKENS = 4;
const FILLER_PATTERNS = [
  /\b(required|optional)\b/g,
  /\bplease\b/g,
  /\bselect one\b/g,
  /\bchoose one\b/g,
  /\benter your\b/g,
  /\btype your\b/g
];

const SAFETY_RULES: Array<{ category: SavedFormAnswerSafetyCategory; patterns: RegExp[] }> = [
  {
    category: 'legal',
    patterns: [
      /\blegal\b/,
      /\bdeclaration\b/,
      /\bdeclare\b/,
      /\bconsent\b/,
      /\bterms\b/,
      /\bagree\b/,
      /\bcriminal\b/,
      /\bconviction\b/,
      /\bbackground check\b/,
      /\bpolice check\b/
    ]
  },
  {
    category: 'work_rights',
    patterns: [
      /\bwork rights?\b/,
      /\bright to work\b/,
      /\bvisa\b/,
      /\bsponsorship\b/,
      /\bcitizen(ship)?\b/,
      /\bpermanent resident\b/
    ]
  },
  {
    category: 'salary',
    patterns: [/\bsalary\b/, /\bcompensation\b/, /\bpay\b/, /\bremuneration\b/, /\brate\b/]
  },
  {
    category: 'demographic',
    patterns: [
      /\bgender\b/,
      /\brace\b/,
      /\bethnicity\b/,
      /\bdisability\b/,
      /\bveteran\b/,
      /\bindigenous\b/,
      /\baboriginal\b/,
      /\bdate of birth\b/,
      /\bdob\b/,
      /\bage\b/
    ]
  },
  {
    category: 'availability',
    patterns: [
      /\bavailability\b/,
      /\bavailable\b/,
      /\bstart date\b/,
      /\bnotice period\b/,
      /\bwhen can you start\b/,
      /\bshift\b/,
      /\broster\b/,
      /\brelocat(e|ion)\b/
    ]
  },
  {
    category: 'certification',
    patterns: [/\bcertification\b/, /\bcertificate\b/, /\blicen[cs]e\b/, /\baccreditation\b/]
  },
  {
    category: 'degree',
    patterns: [/\bdegree\b/, /\bdiploma\b/, /\bbachelor\b/, /\bmasters?\b/, /\bphd\b/, /\beducation\b/]
  },
  {
    category: 'clearance',
    patterns: [/\bclearance\b/, /\bsecurity clearance\b/, /\bbaseline\b/, /\bnv1\b/, /\bnv2\b/]
  },
  {
    category: 'reference',
    patterns: [/\breference\b/, /\breferee\b/, /\bformer manager\b/]
  }
];

let database: SqliteDatabase | null = null;

const compactText = (value: string | undefined, maxLength = 2000): string =>
  (value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

const normalizeAnswer = (value: string | undefined): string => compactText(value, 4000).toLowerCase();

const tokenizeQuestion = (value: string): string[] =>
  normalizeQuestion(value)
    .split(' ')
    .map(token => token.trim())
    .filter(token => token.length > 1);

const normalizeBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (TRUE_PATTERN.test(value.trim())) {
      return true;
    }

    if (FALSE_PATTERN.test(value.trim())) {
      return false;
    }
  }

  return false;
};

const normalizeControlKind = (value: unknown): SavedFormAnswerControlKind => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (
      (SAVED_FORM_ANSWER_CONTROL_KINDS as readonly string[]).includes(normalized)
    ) {
      return normalized as SavedFormAnswerControlKind;
    }
  }

  return 'unknown';
};

const normalizeSafetyCategory = (
  value: unknown,
  fallbackQuestion?: string
): SavedFormAnswerSafetyCategory => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (
      (SAVED_FORM_ANSWER_SAFETY_CATEGORIES as readonly string[]).includes(normalized)
    ) {
      return normalized as SavedFormAnswerSafetyCategory;
    }
  }

  return detectSavedFormAnswerSafetyCategory(fallbackQuestion || '');
};

const mapRow = (row: SavedFormAnswerRow): SavedFormAnswer => ({
  id: row.id,
  question: row.question,
  normalizedQuestion: row.normalized_question,
  answer: row.answer,
  normalizedAnswer: row.normalized_answer,
  controlKind: row.control_kind,
  safetyCategory: row.safety_category,
  explicitlyApproved: Boolean(row.explicitly_approved),
  allowAutoReuse: Boolean(row.allow_auto_reuse),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const getDatabase = (): SqliteDatabase => {
  if (database) {
    return database;
  }

  fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
  database = new DatabaseSync(DATABASE_PATH);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS saved_form_answers (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      normalized_question TEXT NOT NULL,
      answer TEXT NOT NULL,
      normalized_answer TEXT NOT NULL,
      control_kind TEXT NOT NULL DEFAULT 'unknown',
      safety_category TEXT NOT NULL DEFAULT 'uncertain',
      explicitly_approved INTEGER NOT NULL DEFAULT 0,
      allow_auto_reuse INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (control_kind IN ('text', 'textarea', 'select', 'checkbox', 'radio', 'file', 'unknown')),
      CHECK (safety_category IN ('safe', 'legal', 'work_rights', 'salary', 'demographic', 'availability', 'certification', 'degree', 'clearance', 'reference', 'uncertain', 'unsupported'))
    );

    CREATE INDEX IF NOT EXISTS idx_saved_form_answers_normalized_question
      ON saved_form_answers (normalized_question);

    CREATE INDEX IF NOT EXISTS idx_saved_form_answers_auto_reuse
      ON saved_form_answers (allow_auto_reuse, explicitly_approved, safety_category, updated_at DESC);
  `);

  const columns = database.prepare(`PRAGMA table_info(saved_form_answers)`).all<ColumnInfoRow>();
  const knownColumns = new Set(columns.map(column => column.name));

  if (!knownColumns.has('control_kind')) {
    database.exec(`ALTER TABLE saved_form_answers ADD COLUMN control_kind TEXT NOT NULL DEFAULT 'unknown'`);
  }

  if (!knownColumns.has('safety_category')) {
    database.exec(`ALTER TABLE saved_form_answers ADD COLUMN safety_category TEXT NOT NULL DEFAULT 'uncertain'`);
  }

  if (!knownColumns.has('explicitly_approved')) {
    database.exec(`ALTER TABLE saved_form_answers ADD COLUMN explicitly_approved INTEGER NOT NULL DEFAULT 0`);
  }

  if (!knownColumns.has('allow_auto_reuse')) {
    database.exec(`ALTER TABLE saved_form_answers ADD COLUMN allow_auto_reuse INTEGER NOT NULL DEFAULT 0`);
  }

  return database;
};

const getSavedFormAnswerById = (id: string): SavedFormAnswer | null => {
  const row = getDatabase()
    .prepare(
      `
        SELECT
          id,
          question,
          normalized_question,
          answer,
          normalized_answer,
          control_kind,
          safety_category,
          explicitly_approved,
          allow_auto_reuse,
          created_at,
          updated_at
        FROM saved_form_answers
        WHERE id = ?
        LIMIT 1
      `
    )
    .get<SavedFormAnswerRow>(id);

  return row ? mapRow(row) : null;
};

const chooseAutoReuse = (input: {
  explicitlyApproved: boolean;
  allowAutoReuse: boolean;
  safetyCategory: SavedFormAnswerSafetyCategory;
}): boolean => input.explicitlyApproved && input.allowAutoReuse && input.safetyCategory === 'safe';

const isControlKindCompatible = (
  savedControlKind: SavedFormAnswerControlKind,
  targetControlKind: SavedFormAnswerControlKind
): boolean => {
  if (savedControlKind === 'unknown' || targetControlKind === 'unknown') {
    return true;
  }

  if (savedControlKind === targetControlKind) {
    return true;
  }

  return (
    (savedControlKind === 'text' || savedControlKind === 'textarea') &&
    (targetControlKind === 'text' || targetControlKind === 'textarea')
  );
};

const optionMatchesAnswer = (
  answer: SavedFormAnswer,
  options: Array<{ label?: string; value?: string }>
): boolean => {
  if (options.length === 0) {
    return true;
  }

  return options.some(option => {
    const label = normalizeAnswer(option.label);
    const value = normalizeAnswer(option.value);
    return label === answer.normalizedAnswer || value === answer.normalizedAnswer;
  });
};

const getQuestionSimilarity = (left: string, right: string): number => {
  const normalizedLeft = normalizeQuestion(left);
  const normalizedRight = normalizeQuestion(right);

  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  const leftTokens = Array.from(new Set(tokenizeQuestion(normalizedLeft)));
  const rightTokens = Array.from(new Set(tokenizeQuestion(normalizedRight)));
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const rightSet = new Set(rightTokens);
  const sharedCount = leftTokens.filter(token => rightSet.has(token)).length;
  if (sharedCount < Math.min(AUTO_REUSE_MIN_SHARED_TOKENS, leftTokens.length, rightTokens.length)) {
    return 0;
  }

  const unionCount = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = unionCount > 0 ? sharedCount / unionCount : 0;
  const leftLength = normalizedLeft.length;
  const rightLength = normalizedRight.length;
  const lengthRatio =
    Math.min(leftLength, rightLength) / Math.max(1, Math.max(leftLength, rightLength));

  if (
    (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) &&
    lengthRatio >= 0.92
  ) {
    return Math.max(jaccard, 0.97);
  }

  return jaccard * lengthRatio;
};

export const normalizeQuestion = (value: string): string => {
  let normalized = compactText(value, 2000).toLowerCase();
  FILLER_PATTERNS.forEach(pattern => {
    normalized = normalized.replace(pattern, ' ');
  });

  return normalized
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const detectSavedFormAnswerSafetyCategory = (
  question: string
): SavedFormAnswerSafetyCategory => {
  const normalized = normalizeQuestion(question);
  const match = SAFETY_RULES.find(rule => rule.patterns.some(pattern => pattern.test(normalized)));
  return match?.category || 'safe';
};

export const initializeSavedFormAnswers = (): void => {
  getDatabase();
};

export const listSavedFormAnswers = (): SavedFormAnswer[] =>
  getDatabase()
    .prepare(
      `
        SELECT
          id,
          question,
          normalized_question,
          answer,
          normalized_answer,
          control_kind,
          safety_category,
          explicitly_approved,
          allow_auto_reuse,
          created_at,
          updated_at
        FROM saved_form_answers
        ORDER BY updated_at DESC, created_at DESC
      `
    )
    .all<SavedFormAnswerRow>()
    .map(mapRow);

export const createSavedFormAnswer = (input: CreateSavedFormAnswerInput): SavedFormAnswer => {
  const question = compactText(input.question, 1000);
  const answer = compactText(input.answer, 4000);

  if (!question) {
    throw new Error('Question is required.');
  }

  if (!answer) {
    throw new Error('Answer is required.');
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const controlKind = normalizeControlKind(input.controlKind);
  const safetyCategory = normalizeSafetyCategory(input.safetyCategory, question);
  const explicitlyApproved = normalizeBoolean(input.explicitlyApproved);
  const allowAutoReuse = chooseAutoReuse({
    explicitlyApproved,
    allowAutoReuse: normalizeBoolean(input.allowAutoReuse),
    safetyCategory
  });

  getDatabase()
    .prepare(
      `
        INSERT INTO saved_form_answers (
          id,
          question,
          normalized_question,
          answer,
          normalized_answer,
          control_kind,
          safety_category,
          explicitly_approved,
          allow_auto_reuse,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      id,
      question,
      normalizeQuestion(question),
      answer,
      normalizeAnswer(answer),
      controlKind,
      safetyCategory,
      explicitlyApproved ? 1 : 0,
      allowAutoReuse ? 1 : 0,
      now,
      now
    );

  return getSavedFormAnswerById(id) as SavedFormAnswer;
};

export const updateSavedFormAnswer = (
  id: string,
  input: UpdateSavedFormAnswerInput
): SavedFormAnswer | null => {
  const existing = getSavedFormAnswerById(id);
  if (!existing) {
    return null;
  }

  const question = compactText(input.question ?? existing.question, 1000);
  const answer = compactText(input.answer ?? existing.answer, 4000);

  if (!question) {
    throw new Error('Question is required.');
  }

  if (!answer) {
    throw new Error('Answer is required.');
  }

  const controlKind =
    input.controlKind === undefined ? existing.controlKind : normalizeControlKind(input.controlKind);
  const safetyCategory =
    input.safetyCategory === undefined
      ? existing.safetyCategory
      : normalizeSafetyCategory(input.safetyCategory, question);
  const explicitlyApproved =
    input.explicitlyApproved === undefined
      ? existing.explicitlyApproved
      : normalizeBoolean(input.explicitlyApproved);
  const allowAutoReuse = chooseAutoReuse({
    explicitlyApproved,
    allowAutoReuse:
      input.allowAutoReuse === undefined
        ? existing.allowAutoReuse
        : normalizeBoolean(input.allowAutoReuse),
    safetyCategory
  });

  getDatabase()
    .prepare(
      `
        UPDATE saved_form_answers
        SET
          question = ?,
          normalized_question = ?,
          answer = ?,
          normalized_answer = ?,
          control_kind = ?,
          safety_category = ?,
          explicitly_approved = ?,
          allow_auto_reuse = ?,
          updated_at = ?
        WHERE id = ?
      `
    )
    .run(
      question,
      normalizeQuestion(question),
      answer,
      normalizeAnswer(answer),
      controlKind,
      safetyCategory,
      explicitlyApproved ? 1 : 0,
      allowAutoReuse ? 1 : 0,
      new Date().toISOString(),
      id
    );

  return getSavedFormAnswerById(id);
};

export const deleteSavedFormAnswer = (id: string): boolean => {
  const result = getDatabase()
    .prepare(`DELETE FROM saved_form_answers WHERE id = ?`)
    .run(id);

  return result.changes > 0;
};

export const findHighConfidenceSavedFormAnswer = (
  options: SavedFormAnswerMatchOptions
): SavedFormAnswer | null => {
  const question = compactText(options.question, 2000);
  if (!question) {
    return null;
  }

  const normalizedQuestion = normalizeQuestion(question);
  if (!normalizedQuestion) {
    return null;
  }

  const controlKind = normalizeControlKind(options.controlKind);
  const candidates = getDatabase()
    .prepare(
      `
        SELECT
          id,
          question,
          normalized_question,
          answer,
          normalized_answer,
          control_kind,
          safety_category,
          explicitly_approved,
          allow_auto_reuse,
          created_at,
          updated_at
        FROM saved_form_answers
        WHERE allow_auto_reuse = 1
          AND explicitly_approved = 1
          AND safety_category = 'safe'
        ORDER BY updated_at DESC, created_at DESC
      `
    )
    .all<SavedFormAnswerRow>()
    .map(mapRow)
    .filter(answer => isControlKindCompatible(answer.controlKind, controlKind))
    .filter(answer => optionMatchesAnswer(answer, options.options || []))
    .map(answer => ({
      answer,
      score: getQuestionSimilarity(normalizedQuestion, answer.normalizedQuestion)
    }))
    .filter(candidate => candidate.score >= AUTO_REUSE_MIN_SCORE)
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.answer || null;
};
