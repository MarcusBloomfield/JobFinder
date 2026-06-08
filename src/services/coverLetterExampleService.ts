import axios from 'axios';
import { CoverLetterExample } from '../models/CoverLetterExample';

const API_URL = 'http://localhost:5000/api';

export const parseCoverLetterExample = async (file: File): Promise<CoverLetterExample> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await axios.post(`${API_URL}/cover-letter-examples/parse`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });

  if (response.data && response.data.data) {
    return response.data.data as CoverLetterExample;
  }

  throw new Error('Invalid response format from cover letter example API');
};
