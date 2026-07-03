import axios from 'axios';

const API_URL = 'http://localhost:5000/api';

export type SavedFormAnswerControlKind =
  | 'text'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'file'
  | 'unknown';

export type SavedFormAnswerSafetyCategory =
  | 'safe'
  | 'legal'
  | 'work_rights'
  | 'salary'
  | 'demographic'
  | 'availability'
  | 'certification'
  | 'degree'
  | 'clearance'
  | 'reference'
  | 'uncertain'
  | 'unsupported';

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

export interface SaveFormAnswerInput {
  question: string;
  answer: string;
  controlKind?: SavedFormAnswerControlKind;
  safetyCategory?: SavedFormAnswerSafetyCategory;
  explicitlyApproved?: boolean;
  allowAutoReuse?: boolean;
}

const getResponseData = <Data>(responseData: unknown): Data => {
  if (responseData && typeof responseData === 'object' && 'data' in responseData) {
    return (responseData as { data: Data }).data;
  }

  throw new Error('Invalid response format from saved answers API');
};

export const listSavedFormAnswers = async (): Promise<SavedFormAnswer[]> => {
  const response = await axios.get(`${API_URL}/saved-form-answers`);
  return getResponseData<SavedFormAnswer[]>(response.data);
};

export const createSavedFormAnswer = async (
  input: SaveFormAnswerInput
): Promise<SavedFormAnswer> => {
  const response = await axios.post(`${API_URL}/saved-form-answers`, input);
  return getResponseData<SavedFormAnswer>(response.data);
};

export const updateSavedFormAnswer = async (
  id: string,
  input: Partial<SaveFormAnswerInput>
): Promise<SavedFormAnswer> => {
  const response = await axios.put(`${API_URL}/saved-form-answers/${encodeURIComponent(id)}`, input);
  return getResponseData<SavedFormAnswer>(response.data);
};

export const deleteSavedFormAnswer = async (id: string): Promise<void> => {
  await axios.delete(`${API_URL}/saved-form-answers/${encodeURIComponent(id)}`);
};
