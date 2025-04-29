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
  
  console.log('Generating search terms for resume...');
  console.log('Resume content length:', resume.content.length);
  
  // Log the actual content being sent (first 500 chars for brevity)
  console.log('Resume content snippet:', resume.content ? resume.content.substring(0, 500) + (resume.content.length > 500 ? '...' : '') : '[EMPTY]');
  
  // Make sure we have content to analyze
  if (!resume.content || resume.content.trim().length < 100) {
    console.error('Resume content is empty or too short to analyze.');
    throw new Error('Resume content is empty or too short to be analyzed effectively.');
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `You are a highly precise resume analysis tool.
                Your sole function is to extract relevant job search terms directly from the provided resume content.
                Do NOT invent terms, infer positions, or use information not explicitly present in the resume.
                Stick strictly to the text provided.`
    },
    {
      role: 'user',
      content: `RESUME CONTENT START
${resume.content}
RESUME CONTENT END

Based ONLY on the resume content provided above:
1. Identify the most prominent and relevant skills, technologies, job titles, and industry keywords mentioned.
2. From those identified terms, select exactly 5-8 job titles that would be effective job search terms for roles matching this specific resume.
3. Prioritize terms that appear frequently or in significant contexts (like job titles or key skills sections).
4. Format your response strictly as a JSON object with a single field "searchTerms" containing an array of strings.
5. Do not include any introductory text, explanations, or apologies. Only the JSON object.`
    }
  ];
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o', // Using gpt-4o for potentially better accuracy
      messages: messages,
      temperature: 0.1, // Further reduced temperature for precision
      response_format: { type: 'json_object' }
    });
    
    const responseContent = response.choices[0]?.message.content;
    if (!responseContent) {
      console.error('Empty response content from OpenAI');
      throw new Error('Empty response from OpenAI');
    }
    
    console.log('Raw OpenAI response:', responseContent);
    
    try {
      // Parse the JSON response from OpenAI
      const jsonResponse = JSON.parse(responseContent);
    
      // Extract the array of search terms
      if (Array.isArray(jsonResponse.searchTerms)) {
        if (jsonResponse.searchTerms.length === 0) {
          console.error('No search terms found in OpenAI response');
          throw new Error('No search terms found in OpenAI response');
        }
        console.log('Successfully generated search terms:', jsonResponse.searchTerms);
        return jsonResponse.searchTerms;
      } else {
        console.error('Unexpected JSON structure from OpenAI:', jsonResponse);
        
        // Attempt a more flexible extraction if the primary field is missing
        for (const key in jsonResponse) {
          if (Array.isArray(jsonResponse[key])) {
            console.warn(`Found search terms in alternate field: '${key}'. Returning these.`);
            return jsonResponse[key];
          }
        }
        
        throw new Error('Could not find a valid "searchTerms" array in the OpenAI response.');
      }
    } catch (parseError) {
      console.error('Error parsing OpenAI JSON response:', parseError, '\nRaw response:', responseContent);
      throw new Error(`Failed to parse OpenAI response. Raw response: ${responseContent}`);
    }
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
        console.error('OpenAI API Error:', error.status, error.name, error.message);
    } else {
        console.error('Error calling OpenAI API:', error);
    }
    throw new Error('Failed to generate search terms due to an API error or unexpected issue.');
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
                    Rate the match on a scale from 0 to 100.
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