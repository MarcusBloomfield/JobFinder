import { Resume } from '../models/Resume';
import { Job } from '../models/Job';
import { AiModel } from '../models/AiSettings';
import * as openaiService from './openaiService';

const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 20000);
const LLM_MIN_CALL_INTERVAL_MS = Number(process.env.LLM_MIN_CALL_INTERVAL_MS || 60);
const MAX_RESUME_CHARS = Number(process.env.LLM_MAX_RESUME_CHARS || 12000);
const MAX_JOB_DESC_CHARS = Number(process.env.LLM_MAX_JOB_DESC_CHARS || 4000);
const MAX_SEARCH_TERMS = Number(process.env.LLM_MAX_SEARCH_TERMS || 8);
const MIN_SEARCH_TERMS = Number(process.env.LLM_MIN_SEARCH_TERMS || 5);

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /\b(?:\+?\d[\d()\-\s]{7,}\d)\b/g;
const URL_PATTERN = /\bhttps?:\/\/[^\s]+/gi;

let llmCallChain: Promise<void> = Promise.resolve();
let lastLlmCallAt = 0;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const sanitizeText = (text: string, maxLength: number): string => {
  const withoutControls = text.replace(/[\u0000-\u001F\u007F]/g, ' ');
  const collapsed = withoutControls.replace(/\s+/g, ' ').trim();
  return collapsed.slice(0, maxLength);
};

const redactSensitive = (text: string): string => {
  return text
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]')
    .replace(PHONE_PATTERN, '[REDACTED_PHONE]')
    .replace(URL_PATTERN, '[REDACTED_URL]');
};

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`LLM call exceeded timeout (${ms}ms)`)), ms);
    promise
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
};

const runThrottled = async <T>(fn: () => Promise<T>): Promise<T> => {
  const scheduled = llmCallChain.then(async () => {
    const now = Date.now();
    const waitMs = Math.max(0, lastLlmCallAt + LLM_MIN_CALL_INTERVAL_MS - now);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    lastLlmCallAt = Date.now();
  });

  llmCallChain = scheduled.then(() => undefined, () => undefined);
  await scheduled;
  return fn();
};

const sanitizeResume = (resume: Resume): Resume => {
  return {
    ...resume,
    content: redactSensitive(sanitizeText(resume.content || '', MAX_RESUME_CHARS))
  };
};

const sanitizeJob = (job: Job): Job => {
  return {
    ...job,
    title: sanitizeText(job.title || '', 200),
    company: sanitizeText(job.company || '', 200),
    description: redactSensitive(sanitizeText(job.description || '', MAX_JOB_DESC_CHARS))
  };
};

const normalizeSearchTerm = (term: string): string => sanitizeText(term, 80);

const validateSearchTerms = (terms: string[]): string[] => {
  const filtered = terms
    .map(normalizeSearchTerm)
    .filter(term => term.length >= 2)
    .filter(term => /^[a-zA-Z0-9+.#&/\- ]+$/.test(term));

  const unique = Array.from(new Set(filtered));
  if (unique.length < MIN_SEARCH_TERMS) {
    throw new Error(`Sandbox rejected LLM output: expected at least ${MIN_SEARCH_TERMS} search terms`);
  }
  return unique.slice(0, MAX_SEARCH_TERMS);
};

const validateScore = (score: number): number => {
  if (!Number.isFinite(score)) {
    throw new Error('Sandbox rejected LLM output: score is not finite');
  }
  return Math.max(0, Math.min(100, Math.round(score)));
};

export const generateSearchTerms = async (resume: Resume, aiModel?: AiModel): Promise<string[]> => {
  const safeResume = sanitizeResume(resume);
  const terms = await runThrottled(() =>
    withTimeout(openaiService.generateSearchTerms(safeResume, aiModel), LLM_TIMEOUT_MS)
  );
  return validateSearchTerms(terms);
};

export const evaluateJobMatch = async (job: Job, resume: Resume, aiModel?: AiModel): Promise<number> => {
  const safeJob = sanitizeJob(job);
  const safeResume = sanitizeResume(resume);
  const score = await runThrottled(() =>
    withTimeout(openaiService.evaluateJobMatch(safeJob, safeResume, aiModel), LLM_TIMEOUT_MS)
  );
  return validateScore(score);
};
