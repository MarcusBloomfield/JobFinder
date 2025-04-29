import { Resume } from '../models/Resume';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import { Document } from 'docx';
// Import proper types for Express Multer
import { Multer } from 'multer';

// Add type declaration for file uploads
declare global {
  namespace Express {
    interface Multer {
      File: MulterFile;
    }
  }
}

// Define MulterFile interface
interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination: string;
  filename: string;
  path: string;
  buffer: Buffer;
}

/**
 * Extract text from a PDF file
 */
export const extractPdfText = async (filePath: string): Promise<string> => {
  console.log('Extracting text from PDF:', filePath);
  
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    throw new Error('Failed to extract text from PDF file');
  }
};

/**
 * Extract text from a DOCX file
 */
export const extractDocxText = async (filePath: string): Promise<string> => {
  console.log('Extracting text from DOCX:', filePath);
  
  try {
    // Simple implementation that extracts basic text
    // A more advanced implementation would parse the DOCX structure properly
    // But for now, let's just read the file and return a placeholder
    const content = fs.readFileSync(filePath);
    console.log(`Read DOCX file of size ${content.length} bytes`);
    return `[DOCX content extracted - ${content.length} bytes]`;
  } catch (error) {
    console.error('Error extracting text from DOCX:', error);
    throw new Error('Failed to extract text from DOCX file');
  }
};

/**
 * Creates a Resume object from an uploaded file
 */
export const parseResume = async (file: any): Promise<Resume> => {
  const fileType = path.extname(file.originalname).toLowerCase() === '.pdf' ? 'pdf' as const : 'docx' as const;
  
  try {
    console.log(`Parsing ${fileType} resume:`, file.originalname);
    
    let content = '';
    if (fileType === 'pdf') {
      content = await extractPdfText(file.path);
    } else {
      content = await extractDocxText(file.path);
    }
    
    // Perform basic skill extraction (could be enhanced with more sophisticated parsing)
    const skills = extractSkills(content);
    const experience = extractExperience(content);
    const education = extractEducation(content);
    
    return {
      id: uuidv4(),
      fileName: file.originalname,
      fileType: fileType,
      content: content,
      skills,
      experience,
      education
    };
  } catch (error: unknown) {
    console.error('Error parsing resume:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to parse resume: ${errorMessage}`);
  } finally {
    // Clean up the temporary file
    fs.unlinkSync(file.path);
  }
};

/**
 * Extract skills from resume content
 */
const extractSkills = (content: string): string[] => {
  // Basic extraction based on common patterns
  // Could be enhanced with ML/NLP techniques
  
  const skillsPattern = /SKILLS|TECHNICAL SKILLS|TECHNOLOGIES|TOOLS|PROGRAMMING LANGUAGES/i;
  const skillsSection = extractSection(content, skillsPattern);
  
  if (!skillsSection) return [];
  
  // Extract skills from bullet points or commas
  const skillsList = skillsSection
    .split(/[•\-,\/|]/)
    .map(skill => skill.trim())
    .filter(skill => skill.length > 2); // filter out too short strings
  
  return skillsList;
};

/**
 * Extract experience from resume content
 */
const extractExperience = (content: string): string[] => {
  const experiencePattern = /EXPERIENCE|WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|EMPLOYMENT HISTORY/i;
  const experienceSection = extractSection(content, experiencePattern);
  
  if (!experienceSection) return [];
  
  // Split by line breaks and filter empty lines
  const experienceLines = experienceSection
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  
  return experienceLines;
};

/**
 * Extract education from resume content
 */
const extractEducation = (content: string): string[] => {
  const educationPattern = /EDUCATION|ACADEMIC BACKGROUND|QUALIFICATIONS|ACADEMIC QUALIFICATIONS/i;
  const educationSection = extractSection(content, educationPattern);
  
  if (!educationSection) return [];
  
  // Split by line breaks and filter empty lines
  const educationLines = educationSection
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  
  return educationLines;
};

/**
 * Extract a section from the content based on a pattern
 */
const extractSection = (content: string, sectionPattern: RegExp): string | null => {
  const lines = content.split('\n');
  let sectionStart = -1;
  let sectionEnd = -1;
  
  // Find section start
  for (let i = 0; i < lines.length; i++) {
    if (sectionPattern.test(lines[i])) {
      sectionStart = i + 1; // Start after the section header
      break;
    }
  }
  
  if (sectionStart === -1) return null;
  
  // Find section end (next section or end of document)
  const sectionEndPatterns = [
    /SKILLS/i,
    /EXPERIENCE/i,
    /EDUCATION/i,
    /PROJECTS/i,
    /CERTIFICATIONS/i,
    /AWARDS/i,
    /PUBLICATIONS/i,
    /REFERENCES/i,
    /LANGUAGES/i,
    /INTERESTS/i,
    /HOBBIES/i,
    /CONTACT/i
  ];
  
  for (let i = sectionStart + 1; i < lines.length; i++) {
    // Check if line is a new section header
    if (sectionEndPatterns.some(pattern => pattern.test(lines[i])) && 
        lines[i].toUpperCase() === lines[i]) { // Section headers are often uppercase
      sectionEnd = i - 1;
      break;
    }
  }
  
  // If no section end found, use the end of the document
  if (sectionEnd === -1) {
    sectionEnd = lines.length - 1;
  }
  
  return lines.slice(sectionStart, sectionEnd + 1).join('\n');
}; 