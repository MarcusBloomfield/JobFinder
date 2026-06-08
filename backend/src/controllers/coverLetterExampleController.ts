import { Request, Response } from 'express';
import * as coverLetterExampleService from '../services/coverLetterExampleService';

export const parseCoverLetterExample = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: true,
        message: 'No file uploaded. Please upload a PDF or DOCX cover letter.'
      });
    }

    const example = await coverLetterExampleService.parseCoverLetterExample(req.file);

    res.status(200).json({
      error: false,
      message: 'Cover letter example parsed successfully',
      data: example
    });
  } catch (error) {
    console.error('Error parsing cover letter example:', error);
    res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};
