import path from 'path';
import { randomUUID } from 'crypto';
import { CoverLetterExample } from '../models/CoverLetterExample';
import { extractDocxText, extractPdfText } from './resumeParserService';

export const parseCoverLetterExample = async (file: Express.Multer.File): Promise<CoverLetterExample> => {
  const extension = path.extname(file.originalname).toLowerCase();
  const fileType = extension === '.pdf' ? 'pdf' : 'docx';
  const content = fileType === 'pdf' ? await extractPdfText(file.path) : await extractDocxText(file.path);

  return {
    id: randomUUID(),
    fileName: file.originalname,
    fileType,
    content,
    uploadedAt: new Date().toISOString()
  };
};
