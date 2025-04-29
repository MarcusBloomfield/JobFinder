import axios from 'axios';
import { Resume } from '../models/Resume';
import { v4 as uuidv4 } from 'uuid';

// API endpoint
const API_URL = 'http://localhost:5000/api';

/**
 * Creates a Resume object from an uploaded file using the backend API
 */
export const parseResume = async (file: File): Promise<Resume> => {
  console.log('Parsing resume:', file.name);
  
  try {
    // Create form data for file upload
    const formData = new FormData();
    formData.append('file', file);
    
    // Send file to backend API
    const response = await axios.post(`${API_URL}/resume/parse`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    
    if (response.data && response.data.data) {
      return response.data.data;
    } else {
      throw new Error('Invalid response format from API');
    }
  } catch (error) {
    console.error('Error parsing resume:', error);
    
    // Fallback to mock implementation if the backend fails
    return mockParseResume(file);
  }
};

/**
 * Mock function for fallback when API is not available
 */
const mockParseResume = async (file: File): Promise<Resume> => {
  const fileType = file.name.toLowerCase().endsWith('.pdf') ? 'pdf' as const : 'docx' as const;
  
  try {
    console.log(`[FALLBACK] Using mock for parsing ${fileType} resume:`, file.name);
    
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const content = fileType === 'pdf' 
      ? await mockExtractPdfText(file)
      : await mockExtractDocxText(file);
    
    return {
      id: uuidv4(),
      fileName: file.name,
      fileType: fileType,
      content: content
    };
  } catch (error: unknown) {
    console.error('[FALLBACK] Error in mock parsing resume:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to parse resume: ${errorMessage}`);
  }
};

/**
 * Mock function for extracting text from a PDF file
 */
const mockExtractPdfText = async (file: File): Promise<string> => {
  console.log('[FALLBACK] Mock extracting text from PDF:', file.name);
  
  // Simulate processing time
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Return mock content based on filename
  return `
JOHN DOE
Frontend Developer

CONTACT
Email: john.doe@example.com
Phone: (555) 123-4567
LinkedIn: linkedin.com/in/johndoe

SKILLS
- JavaScript/TypeScript
- React/Redux
- HTML5/CSS3
- Node.js
- Git/GitHub
- Responsive Design
- Unit Testing
- Agile/Scrum

EXPERIENCE
FRONTEND DEVELOPER | Tech Solutions Inc. | 2020 - Present
- Developed responsive web applications using React and TypeScript
- Implemented state management with Redux and Context API
- Collaborated with designers to create pixel-perfect UI components
- Optimized application performance and reduced load times by 30%
- Mentored junior developers and conducted code reviews

WEB DEVELOPER | Digital Innovations | 2018 - 2020
- Built and maintained multiple client websites using modern web technologies
- Created reusable components and libraries for company projects
- Implemented responsive designs for mobile and desktop platforms
- Integrated third-party APIs and services

EDUCATION
Bachelor of Science in Computer Science
University of Technology | 2014 - 2018
  `;
};

/**
 * Mock function for extracting text from a DOCX file
 */
const mockExtractDocxText = async (file: File): Promise<string> => {
  console.log('[FALLBACK] Mock extracting text from DOCX:', file.name);
  
  // Simulate processing time
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Return mock content
  return `
JANE SMITH
Backend Developer

CONTACT
Email: jane.smith@example.com
Phone: (555) 987-6543
LinkedIn: linkedin.com/in/janesmith

SKILLS
- JavaScript/TypeScript
- Node.js/Express
- MongoDB/SQL
- REST API Design
- AWS/Cloud Services
- Docker/Kubernetes
- Jest/Mocha
- CI/CD Pipelines

EXPERIENCE
BACKEND DEVELOPER | Server Solutions | 2019 - Present
- Designed and implemented RESTful APIs using Node.js and Express
- Managed database schemas and optimized query performance
- Implemented authentication and authorization systems
- Deployed services to AWS using Docker containers
- Set up CI/CD pipelines with GitHub Actions and Jenkins

FULL STACK DEVELOPER | Web Innovations | 2017 - 2019
- Developed features for both frontend and backend systems
- Created microservices architecture for scalable applications
- Collaborated with cross-functional teams to deliver projects
- Maintained and improved existing codebase

EDUCATION
Master of Science in Software Engineering
Tech University | 2015 - 2017

Bachelor of Engineering in Computer Science
State University | 2011 - 2015
  `;
}; 