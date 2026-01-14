import { GoogleGenerativeAI } from '@google/generative-ai';
import { Resume } from '../models/Resume';
import { Job } from '../models/Job';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize Gemini client with API key from environment variables
let genAI: GoogleGenerativeAI;

// Check if API key is configured
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ CRITICAL: GEMINI_API_KEY is not set!');
  console.error('Please set GEMINI_API_KEY in system environment variables or backend/.env');
  console.error('Get your API key from: https://aistudio.google.com/apikey');
} else {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  console.log('✓ Gemini API initialized successfully');
}

/**
 * Generate job search terms from resume content
 */
export const generateSearchTerms = async (resume: Resume): Promise<string[]> => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Gemini API key is not configured. Please set GEMINI_API_KEY in system environment variables or backend/.env file. Get your key from: https://aistudio.google.com/apikey');
  }
  
  console.log('Generating search terms for resume...');
  console.log('Resume content length:', resume.content.length);
  
  // Log the actual content being sent (first 500 chars for brevity)
  console.log('Resume content snippet:', resume.content ? resume.content.substring(0, 500) + (resume.content.length > 500 ? '...' : '') : '[EMPTY]');
  
  // Make sure we have content to analyze
  if (!resume.content || resume.content.trim().length < 100) {
    console.error('Resume content is empty or too short to analyze.');
    throw new Error('Resume content is empty or too short to be analyzed effectively.');
  }

  // Use Gemini 2.5 Flash for better free tier availability
  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json'
    }
  });

  const prompt = `You are a highly precise resume analysis tool.
Your sole function is to extract relevant job search terms directly from the provided resume content.
Do NOT invent terms, infer positions, or use information not explicitly present in the resume.
Stick strictly to the text provided.

RESUME CONTENT START
${resume.content}
RESUME CONTENT END

Based ONLY on the resume content provided above:
1. Identify the most prominent and relevant skills, technologies, job titles, and industry keywords mentioned.
2. From those identified terms, select exactly 5-8 job titles that would be effective job search terms for roles matching this specific resume.
3. Prioritize terms that appear frequently or in significant contexts (like job titles or key skills sections).
4. Format your response strictly as a JSON object with a single field "searchTerms" containing an array of strings.
5. Do not include any introductory text, explanations, or apologies. Only the JSON object.`;
  
  try {
    const result = await model.generateContent(prompt);
    const responseContent = result.response.text();
    
    if (!responseContent) {
      console.error('Empty response content from Gemini');
      throw new Error('Empty response from Gemini');
    }
    
    console.log('Raw Gemini response:', responseContent);
    
    try {
      // Parse the JSON response from Gemini
      const jsonResponse = JSON.parse(responseContent);
    
      // Extract the array of search terms
      if (Array.isArray(jsonResponse.searchTerms)) {
        if (jsonResponse.searchTerms.length === 0) {
          console.error('No search terms found in Gemini response');
          throw new Error('No search terms found in Gemini response');
        }
        console.log('Successfully generated search terms:', jsonResponse.searchTerms);
        return jsonResponse.searchTerms;
      } else {
        console.error('Unexpected JSON structure from Gemini:', jsonResponse);
        
        // Attempt a more flexible extraction if the primary field is missing
        for (const key in jsonResponse) {
          if (Array.isArray(jsonResponse[key])) {
            console.warn(`Found search terms in alternate field: '${key}'. Returning these.`);
            return jsonResponse[key];
          }
        }
        
        throw new Error('Could not find a valid "searchTerms" array in the Gemini response.');
      }
    } catch (parseError) {
      console.error('Error parsing Gemini JSON response:', parseError, '\nRaw response:', responseContent);
      throw new Error(`Failed to parse Gemini response. Raw response: ${responseContent}`);
    }
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    throw new Error('Failed to generate search terms due to an API error or unexpected issue.');
  }
};

/**
 * Evaluate job match quality against resume
 */
export const evaluateJobMatch = async (job: Job, resume: Resume): Promise<number> => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Gemini API key is not configured. Please set GEMINI_API_KEY in system environment variables or backend/.env file. Get your key from: https://aistudio.google.com/apikey');
  }

  console.log('Evaluating job match:', job.title);
  
  // Use Gemini 2.5 Flash for better free tier availability
  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.3,
      responseMimeType: 'application/json'
    }
  });

  const prompt = `You are a helpful assistant that evaluates how well a job listing matches a candidate's resume.
Rate the match on a scale from 0 to 100.
Respond with ONLY a JSON object with a single field "score" containing the numeric score.

Resume:
${resume.content}

Job:
Title: ${job.title}
Company: ${job.company}
Description: ${job.description}`;

  try {
    const result = await model.generateContent(prompt);
    const responseContent = result.response.text();
    
    if (!responseContent) {
      console.error('Empty response from Gemini for job:', job.title);
      throw new Error('Empty response from Gemini');
    }
    
    console.log('Raw Gemini response for job match:', responseContent);
    
    try {
      // Parse the JSON response from Gemini
      const jsonResponse = JSON.parse(responseContent);
      
      // Extract the score
      if (typeof jsonResponse.score === 'number') {
        console.log(`Match score for "${job.title}": ${jsonResponse.score}`);
        return jsonResponse.score;
      } else {
        console.error('Unexpected response format from Gemini:', jsonResponse);
        console.error('Full response object:', JSON.stringify(jsonResponse, null, 2));
        throw new Error('Could not find match score in Gemini response');
      }
    } catch (parseError) {
      console.error('Error parsing Gemini response:', parseError);
      console.error('Raw response was:', responseContent);
      throw new Error('Failed to parse Gemini response');
    }
  } catch (error: any) {
    console.error('Error calling Gemini API for job:', job.title);
    console.error('Error details:', error.message || error);
    if (error.response) {
      console.error('API response error:', error.response);
    }
    throw new Error(`Failed to evaluate job match: ${error.message || 'Unknown error'}`);
  }
};
