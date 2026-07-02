export const AI_MODEL_OPTIONS = ['gpt-5.4', 'gpt-5.4-mini'] as const;

export type AiModel = (typeof AI_MODEL_OPTIONS)[number];

export interface AiSettings {
  model: AiModel;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  model: 'gpt-5.4-mini'
};

export const isAiModel = (value: unknown): value is AiModel =>
  typeof value === 'string' && AI_MODEL_OPTIONS.includes(value as AiModel);

export const normalizeAiSettings = (value: unknown): AiSettings => {
  const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    model: isAiModel(candidate.model) ? candidate.model : DEFAULT_AI_SETTINGS.model
  };
};
