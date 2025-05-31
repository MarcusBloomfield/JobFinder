import axios from 'axios';
import { Resume } from '../models/Resume';
import { Job } from '../models/Job';

// API endpoint
const API_URL = 'http://localhost:5000/api';

/**
 * Generate job search terms from resume content
 */
export const generateSearchTerms = async (resume: Resume): Promise<string[]> => {
  console.log('Generating search terms from resume');
  
  try {
    // Call backend API
    const response = await axios.post(`${API_URL}/openai/generate-search-terms`, { resume });
    
    if (response.data && response.data.data) {
      return response.data.data;
    } else {
      throw new Error('Invalid response format from API');
    }
  } catch (error) {
    console.error('Error calling OpenAI API:', error);
    
    // Fallback to mock implementation if the backend fails
    return mockGenerateSearchTerms(resume);
  }
};

/**
 * Evaluate job match quality against resume
 */
export const evaluateJobMatch = async (job: Job, resume: Resume): Promise<number> => {
  console.log('Evaluating job match:', job.title);
  
  try {
    // Call backend API
    const response = await axios.post(`${API_URL}/openai/evaluate-job-match`, { job, resume });
    
    if (response.data && response.data.data && typeof response.data.data.matchScore === 'number') {
      return response.data.data.matchScore;
    } else {
      throw new Error('Invalid response format from API');
    }
  } catch (error) {
    console.error('Error calling OpenAI API:', error);
    
    // Fallback to mock implementation if the backend fails
    return mockEvaluateJobMatch(job, resume);
  }
};

/**
 * Mock function for generating search terms
 */
const mockGenerateSearchTerms = async (resume: Resume): Promise<string[]> => {
  console.log('[FALLBACK] Mock generating search terms from resume');
  
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Extract mock search terms based on resume content
  const content = resume.content.toLowerCase();
  const terms: string[] = [];
  
  if (content.includes('frontend') || content.includes('react')) {
    terms.push('Frontend Developer', 'React Developer', 'JavaScript Developer');
  }
  
  if (content.includes('backend') || content.includes('node')) {
    terms.push('Backend Developer', 'Node.js Developer', 'Full Stack Developer');
  }
  
  if (content.includes('typescript')) {
    terms.push('TypeScript', 'TypeScript Developer');
  }
  
  if (content.includes('react')) {
    terms.push('React', 'React.js', 'Frontend Framework');
  }
  
  if (content.includes('responsive') || content.includes('css')) {
    terms.push('UI/UX', 'CSS', 'Responsive Design');
  }
  
  // Add some default terms if we couldn't extract enough
  if (terms.length < 5) {
    terms.push('Web Developer', 'Software Engineer', 'JavaScript', 'HTML/CSS', 'Git');
  }
  
  // Limit to 10 terms
  return terms.slice(0, 10);
};

/**
 * Mock function for evaluating job match
 */
const mockEvaluateJobMatch = async (job: Job, resume: Resume): Promise<number> => {
  console.log('[FALLBACK] Mock evaluating job match:', job.title);
  
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  // Simple content matching
  const resumeContent = resume.content.toLowerCase();
  const jobContent = [job.title, job.company, job.description].join(' ').toLowerCase();
  
  let score = 50; // Start with neutral score
  
  // Check for keyword matches
  const keywords = [
    'react', 'javascript', 'typescript', 'html', 'css', 'node', 'express',
    'frontend', 'backend', 'fullstack', 'full stack', 'responsive', 'api',
    'database', 'mongodb', 'sql', 'design', 'agile', 'git', 'testing'
  ];
  
  keywords.forEach(keyword => {
    if (resumeContent.includes(keyword) && jobContent.includes(keyword)) {
      score += 5; // Boost score for each matching keyword
    }
  });
  
  // Title matching gives a big boost
  if (job.title.toLowerCase().includes('frontend') && resumeContent.includes('frontend')) {
    score += 15;
  } else if (job.title.toLowerCase().includes('backend') && resumeContent.includes('backend')) {
    score += 15;
  } else if (job.title.toLowerCase().includes('full stack') && 
            (resumeContent.includes('full stack') || resumeContent.includes('fullstack'))) {
    score += 15;
  }
  
  // Cap the score between 0-100
  return Math.min(100, Math.max(0, score));
};

/**
 * Evaluate multiple job matches in bulk
 */
export const evaluateJobMatchesBulk = async (jobs: Job[], resume: Resume): Promise<Record<string, number>> => {
  console.log(`Evaluating ${jobs.length} jobs in bulk`);
  
  try {
    // Call backend API
    const response = await axios.post(`${API_URL}/openai/evaluate-job-matches-bulk`, { jobs, resume });
    
    if (response.data && response.data.data && Array.isArray(response.data.data)) {
      // Convert array of results to a map of jobId -> matchScore
      const resultsMap: Record<string, number> = {};
      response.data.data.forEach((result: { id: string; matchScore: number }) => {
        resultsMap[result.id] = result.matchScore;
      });
      return resultsMap;
    } else {
      throw new Error('Invalid response format from API');
    }
  } catch (error) {
    console.error('Error calling OpenAI bulk API:', error);
    
    // Fallback to evaluating each job individually when the backend fails
    console.log('[FALLBACK] Evaluating jobs individually');
    const resultsMap: Record<string, number> = {};
    
    // Process in smaller batches to avoid overwhelming the client
    const BATCH_SIZE = 3;
    for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
      const batch = jobs.slice(i, i + BATCH_SIZE);
      
      // Process this batch in parallel
      await Promise.all(
        batch.map(async (job) => {
          try {
            const score = await mockEvaluateJobMatch(job, resume);
            resultsMap[job.id] = score;
          } catch (err) {
            console.error(`Error evaluating job "${job.title}":`, err);
            resultsMap[job.id] = 0; // Default score on error
          }
        })
      );
    }
    
    return resultsMap;
  }
}; 