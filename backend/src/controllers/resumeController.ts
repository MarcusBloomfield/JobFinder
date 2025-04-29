import { Request, Response } from 'express';
import * as resumeParserService from '../services/resumeParserService';

// Extend Request with a file property
interface FileRequest extends Request {
  file?: any;
}

/**
 * Parse an uploaded resume
 * @route POST /api/resume/parse
 */
export const parseResume = async (req: FileRequest, res: Response) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        error: true,
        message: 'No file uploaded. Please upload a PDF or DOCX file.'
      });
    }
    
    // Validate file type
    const validTypes = ['.pdf', '.docx'];
    const fileExt = req.file.originalname.toLowerCase().slice(req.file.originalname.lastIndexOf('.'));
    
    if (!validTypes.includes(fileExt)) {
      return res.status(400).json({
        error: true,
        message: `Invalid file type. Supported types: ${validTypes.join(', ')}`
      });
    }
    
    // Parse the resume
    const resume = await resumeParserService.parseResume(req.file);
    
    res.status(200).json({
      error: false,
      message: 'Resume parsed successfully',
      data: resume
    });
  } catch (error) {
    console.error('Error in parseResume controller:', error);
    res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
}; 