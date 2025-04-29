import OpenAI from 'openai';
import { Resume } from '../models/Resume';
import { Job } from '../models/Job';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize OpenAI client with API key from environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Check if API key is configured
if (!process.env.OPENAI_API_KEY) {
  console.warn('WARNING: OPENAI_API_KEY is not set in environment variables. OpenAI features will not work.');
}

/**
 * Generate job search terms from resume content
 */
export const generateSearchTerms = async (resume: Resume): Promise<string[]> => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key is not configured in server environment variables.');
  }
  
  console.log('Open AI successfully initialized');

  console.log('Generating search terms from resume');
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Generate a list of 5-8 search job categories that would yield the most relevant job postings for this candidate.
    Focus on job titles, and industry terms that employers would use in job listings.
    Example: software engineer, developer, programmer, C#, Unity, game development, 3D.
                    Respond with ONLY a JSON object with the field "searchTerms" containing an array of strings.`
        },
        {
          role: 'user',
          content: resume.content
        }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });
    
    const responseContent = response.choices[0]?.message.content;
    if (!responseContent) {
      throw new Error('Empty response from OpenAI');
    }
    
    try {
      // Parse the JSON response from OpenAI
      const jsonResponse = JSON.parse(responseContent);
      
      // Extract the array of search terms
      if (Array.isArray(jsonResponse.searchTerms)) {
        return jsonResponse.searchTerms;
      } else {
        console.error('Unexpected response format from OpenAI:', jsonResponse);
        
        // Fallback to extracting any array found in the response
        for (const key in jsonResponse) {
          if (Array.isArray(jsonResponse[key])) {
            return jsonResponse[key];
          }
        }
        
        throw new Error('Could not find search terms array in OpenAI response');
      }
    } catch (parseError) {
      console.error('Error parsing OpenAI response:', parseError);
      throw new Error('Failed to parse OpenAI response');
    }
  } catch (error) {
    console.error('Error calling OpenAI API:', error);
    throw new Error('Failed to generate search terms from resume');
  }
};

/**
 * Evaluate job match quality against resume
 */
export const evaluateJobMatch = async (job: Job, resume: Resume): Promise<number> => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key is not configured in server environment variables.');
  }

  console.log('Evaluating job match:', job.title);
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a helpful assistant that evaluates how well a job listing matches a candidate's resume.
                    Rate the match on a scale from 0 to 100, where:
                    - 0-20: Poor match with very few matching skills or requirements
                    - 21-40: Below average match with some overlapping skills
                    - 41-60: Average match with several matching skills and requirements
                    - 61-80: Good match with many matching skills and requirements
                    - 81-100: Excellent match with nearly all requirements satisfied
                    Respond with ONLY a JSON object with a single field "score" containing the numeric score.`
        },
        {
          role: 'user',
          content: `Resume:\n${resume.content}\n\nJob:\nTitle: ${job.title}\nCompany: ${job.company}\nDescription: ${job.description}`
        }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });
    
    const responseContent = response.choices[0]?.message.content;
    if (!responseContent) {
      throw new Error('Empty response from OpenAI');
    }
    
    try {
      // Parse the JSON response from OpenAI
      const jsonResponse = JSON.parse(responseContent);
      
      // Extract the score
      if (typeof jsonResponse.score === 'number') {
        return jsonResponse.score;
      } else {
        console.error('Unexpected response format from OpenAI:', jsonResponse);
        throw new Error('Could not find match score in OpenAI response');
      }
    } catch (parseError) {
      console.error('Error parsing OpenAI response:', parseError);
      throw new Error('Failed to parse OpenAI response');
    }
  } catch (error) {
    console.error('Error calling OpenAI API:', error);
    throw new Error('Failed to evaluate job match');
  }
}; 