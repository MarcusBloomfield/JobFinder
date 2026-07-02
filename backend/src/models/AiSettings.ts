export const AI_MODEL_OPTIONS = ['gpt-5.4', 'gpt-5.4-mini'] as const;

export type AiModel = (typeof AI_MODEL_OPTIONS)[number];

export const DEFAULT_AI_MODEL: AiModel = 'gpt-5.4-mini';

export const isAiModel = (value: unknown): value is AiModel =>
  typeof value === 'string' && AI_MODEL_OPTIONS.includes(value as AiModel);

export const normalizeAiModel = (value: unknown, fallback: AiModel = DEFAULT_AI_MODEL): AiModel =>
  isAiModel(value) ? value : fallback;
